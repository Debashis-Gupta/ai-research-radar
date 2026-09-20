#!/usr/bin/env python3
"""Fetch free AI/ML papers, blog posts, and videos for a static GitHub Pages site.

No paid API keys are required for the default setup:
- Papers: arXiv Atom API + Hugging Face Daily Papers + Semantic Scholar Academic Graph + OpenAlex
- Blogs: public RSS/Atom feeds
- Videos: YouTube's public per-channel Atom feeds

The paper pipeline intentionally merges duplicate records across providers. A paper that is
found on arXiv and Hugging Face, for example, appears once with both source labels.
"""

from __future__ import annotations

import hashlib
import html
import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import feedparser
import requests
from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "sources.json"
OUTPUT_PATH = ROOT / "data" / "feed.json"
HEADERS = {"User-Agent": "AI-Research-Radar/2.0 (personal research dashboard)"}


def load_config() -> dict[str, Any]:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def strip_html(text: str | None) -> str:
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def truncate(text: str, n: int = 360) -> str:
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def iso_date(entry: Any) -> str:
    for key in ("published_parsed", "updated_parsed", "created_parsed"):
        value = getattr(entry, key, None)
        if value:
            return datetime.fromtimestamp(time.mktime(value), tz=timezone.utc).isoformat()
    for key in ("published", "updated", "created"):
        value = getattr(entry, key, None)
        if value:
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
            except ValueError:
                pass
    return datetime.now(timezone.utc).isoformat()


def normalize_date(value: str | None) -> str:
    if not value:
        return datetime.now(timezone.utc).isoformat()
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()
    except ValueError:
        return value


def stable_id(prefix: str, value: str) -> str:
    return f"{prefix}-{hashlib.sha1(value.encode('utf-8')).hexdigest()[:16]}"


def get_url(url: str, headers: dict[str, str] | None = None) -> bytes:
    request_headers = {**HEADERS, **(headers or {})}
    response = requests.get(url, headers=request_headers, timeout=30)
    response.raise_for_status()
    return response.content


def get_json(url: str, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None) -> Any:
    request_headers = {**HEADERS, **(headers or {})}
    response = requests.get(url, params=params, headers=request_headers, timeout=35)
    response.raise_for_status()
    return response.json()


def parse_feed(url: str) -> Any:
    # Fetch ourselves so HTTP errors are explicit and one broken feed never kills the job.
    return feedparser.parse(get_url(url))


def entry_link(entry: Any) -> str:
    link = getattr(entry, "link", "") or ""
    if link:
        return link
    guid = getattr(entry, "id", "") or getattr(entry, "guid", "") or ""
    return guid if guid.startswith("http") else ""


def keyword_tags(text: str, keywords: list[str], max_tags: int = 5) -> list[str]:
    low = text.lower()
    found = []
    for keyword in keywords:
        if keyword.lower() in low:
            found.append(keyword)
        if len(found) >= max_tags:
            break
    return found


def fetch_blogs(config: dict[str, Any]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    keywords = config["interest_keywords"]
    for source in config["blogs"]:
        try:
            feed = parse_feed(source["feed"])
            for entry in feed.entries[:30]:
                url = entry_link(entry)
                if not url:
                    continue
                title = strip_html(getattr(entry, "title", "Untitled"))
                summary = strip_html(getattr(entry, "summary", "") or getattr(entry, "description", ""))
                text = f"{title} {summary}"
                items.append({
                    "id": stable_id("blog", url),
                    "title": title,
                    "url": url,
                    "source": source["name"],
                    "published": iso_date(entry),
                    "summary": truncate(summary),
                    "tags": keyword_tags(text, keywords) or ["AI/ML"],
                })
        except Exception as exc:
            print(f"[blogs] {source['name']}: {exc}")
    return dedupe_sort(items)[: config["limits"]["blogs"]]


def fetch_videos(config: dict[str, Any], limit: bool = True) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    keywords = config["interest_keywords"]
    for channel in config["youtube_channels"]:
        url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel['channel_id']}"
        try:
            feed = parse_feed(url)
            for entry in feed.entries[:20]:
                video_url = entry_link(entry)
                if not video_url:
                    continue
                video_id = getattr(entry, "yt_videoid", "") or ""
                title = strip_html(getattr(entry, "title", "Untitled"))
                summary = strip_html(getattr(entry, "summary", "") or getattr(entry, "media_description", ""))
                tags = keyword_tags(f"{title} {summary}", keywords)
                items.append({
                    "id": stable_id("video", video_url),
                    "video_id": video_id,
                    "channel_id": channel["channel_id"],
                    "thumbnail": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg" if video_id else "",
                    "title": title,
                    "url": video_url,
                    "source": channel["name"],
                    "published": iso_date(entry),
                    "summary": truncate(summary),
                    "tags": tags or ["technical video"],
                })
        except Exception as exc:
            print(f"[videos] {channel['name']}: {exc}")
    videos = dedupe_sort(items)
    return videos[: config["limits"]["videos"]] if limit else videos


def arxiv_id_from_url(value: str | None) -> str:
    if not value:
        return ""
    match = re.search(r"arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5})(?:v\d+)?", value, re.I)
    if match:
        return match.group(1)
    match = re.search(r"(?:^|/)(\d{4}\.\d{4,5})(?:v\d+)?(?:$|[?#.])", value)
    return match.group(1) if match else ""


def clean_doi(value: str | None) -> str:
    if not value:
        return ""
    value = value.strip().lower()
    value = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", value)
    return value


def normalized_title(value: str | None) -> str:
    value = strip_html(value or "").lower()
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def paper_identity(item: dict[str, Any]) -> str:
    arxiv = item.get("external_ids", {}).get("arxiv") or arxiv_id_from_url(item.get("url"))
    if arxiv:
        return f"arxiv:{str(arxiv).lower()}"
    doi = clean_doi(item.get("external_ids", {}).get("doi"))
    if doi:
        return f"doi:{doi}"
    title = normalized_title(item.get("title"))
    return f"title:{title}" if title else item.get("url", item.get("id", ""))


def paper_id_from_identity(identity: str) -> str:
    return stable_id("paper", identity)


def fetch_arxiv_papers(config: dict[str, Any]) -> list[dict[str, Any]]:
    source_cfg = config.get("paper_sources", {}).get("arxiv", {"enabled": True})
    if not source_cfg.get("enabled", True):
        return []

    cats = source_cfg.get("categories") or config.get("arxiv_categories", [])
    search_query = " OR ".join(f"cat:{cat}" for cat in cats)
    max_results = source_cfg.get("limit", min(200, max(config["limits"]["papers"] * 2, 100)))
    params = {
        "search_query": search_query,
        "start": 0,
        "max_results": min(200, max_results),
        "sortBy": "submittedDate",
        "sortOrder": "descending",
    }
    url = "https://export.arxiv.org/api/query?" + urlencode(params)
    keywords = config["interest_keywords"]
    items: list[dict[str, Any]] = []
    try:
        feed = parse_feed(url)
        for entry in feed.entries:
            paper_url = entry_link(entry)
            entry_id = getattr(entry, "id", "")
            arxiv_id = arxiv_id_from_url(paper_url) or arxiv_id_from_url(entry_id)
            title = strip_html(getattr(entry, "title", "Untitled"))
            summary = strip_html(getattr(entry, "summary", ""))
            authors = [strip_html(getattr(a, "name", "")) for a in getattr(entry, "authors", [])]
            categories = [getattr(tag, "term", "") for tag in getattr(entry, "tags", []) if getattr(tag, "term", "")]
            matched = keyword_tags(f"{title} {summary}", keywords)
            external_ids = {"arxiv": arxiv_id} if arxiv_id else {}
            identity = f"arxiv:{arxiv_id}" if arxiv_id else f"title:{normalized_title(title)}"
            items.append({
                "id": paper_id_from_identity(identity),
                "title": title,
                "url": paper_url or entry_id,
                "source": "arXiv",
                "sources": ["arXiv"],
                "published": iso_date(entry),
                "summary": truncate(summary, 430),
                "authors": authors,
                "tags": (matched + categories)[:5] or categories[:5],
                "external_ids": external_ids,
            })
    except Exception as exc:
        print(f"[papers] arXiv: {exc}")
    return items


def fetch_huggingface_papers(config: dict[str, Any]) -> list[dict[str, Any]]:
    source_cfg = config.get("paper_sources", {}).get("huggingface", {})
    if not source_cfg.get("enabled", True):
        return []

    keywords = config["interest_keywords"]
    limit = min(100, int(source_cfg.get("limit", 60)))
    sort = source_cfg.get("sort", "trending")
    items: list[dict[str, Any]] = []

    try:
        api = HfApi()
        papers = api.list_daily_papers(sort=sort, limit=limit, token=False)
        for paper in papers:
            arxiv_id = str(getattr(paper, "id", "") or "").strip()
            if not arxiv_id:
                continue
            title = strip_html(getattr(paper, "title", "") or "Untitled")
            summary = strip_html(getattr(paper, "ai_summary", "") or getattr(paper, "summary", "") or "")
            authors = [strip_html(getattr(author, "name", "")) for author in (getattr(paper, "authors", None) or [])]
            ai_keywords = [strip_html(k) for k in (getattr(paper, "ai_keywords", None) or []) if strip_html(k)]
            matched = keyword_tags(f"{title} {summary} {' '.join(ai_keywords)}", keywords)
            published_at = getattr(paper, "published_at", None) or getattr(paper, "submitted_at", None)
            published = published_at.astimezone(timezone.utc).isoformat() if published_at else datetime.now(timezone.utc).isoformat()
            upvotes = int(getattr(paper, "upvotes", 0) or 0)
            identity = f"arxiv:{arxiv_id.lower()}"
            items.append({
                "id": paper_id_from_identity(identity),
                "title": title,
                "url": f"https://huggingface.co/papers/{arxiv_id}",
                "source": "Hugging Face Papers",
                "sources": ["Hugging Face Papers"],
                "published": published,
                "summary": truncate(summary, 430),
                "authors": authors,
                "tags": (ai_keywords + matched + (["HF trending"] if sort == "trending" else []))[:5],
                "external_ids": {"arxiv": arxiv_id},
                "metrics": {"hf_upvotes": upvotes, "hf_comments": int(getattr(paper, "comments", 0) or 0)},
                "project_page": getattr(paper, "project_page", None),
                "github_repo": getattr(paper, "github_repo", None),
            })
    except Exception as exc:
        print(f"[papers] Hugging Face Daily Papers: {exc}")
    return items


def fetch_semantic_scholar_papers(config: dict[str, Any]) -> list[dict[str, Any]]:
    source_cfg = config.get("paper_sources", {}).get("semantic_scholar", {})
    if not source_cfg.get("enabled", True):
        return []

    limit = min(1000, int(source_cfg.get("limit", 80)))
    days_back = max(1, int(source_cfg.get("days_back", 30)))
    query = source_cfg.get(
        "query",
        '("machine learning" | "large language model" | "computer vision" | multimodal | "reinforcement learning" | "generative ai")',
    )
    since = (datetime.now(timezone.utc) - timedelta(days=days_back)).date().isoformat()
    fields = "title,url,abstract,authors,publicationDate,year,fieldsOfStudy,citationCount,externalIds,openAccessPdf,venue"
    params = {
        "query": query,
        "fields": fields,
        "sort": "publicationDate:desc",
        "publicationDateOrYear": f"{since}:",
        "fieldsOfStudy": "Computer Science",
        "limit": limit,
    }
    headers: dict[str, str] = {}
    api_key = os.environ.get("SEMANTIC_SCHOLAR_API_KEY", "").strip()
    if api_key:
        headers["x-api-key"] = api_key

    keywords = config["interest_keywords"]
    items: list[dict[str, Any]] = []
    try:
        payload = get_json("https://api.semanticscholar.org/graph/v1/paper/search/bulk", params=params, headers=headers)
        for paper in payload.get("data", []):
            title = strip_html(paper.get("title") or "Untitled")
            summary = strip_html(paper.get("abstract") or "")
            authors = [strip_html(a.get("name", "")) for a in (paper.get("authors") or []) if a.get("name")]
            fields_of_study = [strip_html(v) for v in (paper.get("fieldsOfStudy") or []) if v]
            external_raw = paper.get("externalIds") or {}
            arxiv_id = str(external_raw.get("ArXiv") or "").strip()
            doi = clean_doi(external_raw.get("DOI"))
            external_ids = {}
            if arxiv_id:
                external_ids["arxiv"] = arxiv_id
            if doi:
                external_ids["doi"] = doi
            identity = paper_identity({"title": title, "external_ids": external_ids, "url": paper.get("url", "")})
            open_pdf = (paper.get("openAccessPdf") or {}).get("url")
            url = paper.get("url") or open_pdf or (f"https://doi.org/{doi}" if doi else "")
            matched = keyword_tags(f"{title} {summary}", keywords)
            citation_count = int(paper.get("citationCount") or 0)
            tags = (matched + fields_of_study + ([paper.get("venue")] if paper.get("venue") else []))[:5]
            published = paper.get("publicationDate") or (f"{paper.get('year')}-01-01" if paper.get("year") else None)
            items.append({
                "id": paper_id_from_identity(identity),
                "title": title,
                "url": url,
                "source": "Semantic Scholar",
                "sources": ["Semantic Scholar"],
                "published": normalize_date(published),
                "summary": truncate(summary, 430),
                "authors": authors,
                "tags": tags,
                "external_ids": external_ids,
                "metrics": {"citation_count": citation_count},
                "pdf_url": open_pdf,
            })
    except Exception as exc:
        print(f"[papers] Semantic Scholar: {exc}")
    return items



def reconstruct_openalex_abstract(inverted: dict[str, list[int]] | None) -> str:
    if not inverted:
        return ""
    positioned: list[tuple[int, str]] = []
    for word, positions in inverted.items():
        for position in positions:
            positioned.append((int(position), word))
    positioned.sort(key=lambda pair: pair[0])
    return " ".join(word for _, word in positioned)


def fetch_openalex_papers(config: dict[str, Any]) -> list[dict[str, Any]]:
    source_cfg = config.get("paper_sources", {}).get("openalex", {})
    if not source_cfg.get("enabled", True):
        return []

    days_back = max(1, int(source_cfg.get("days_back", 30)))
    since = (datetime.now(timezone.utc) - timedelta(days=days_back)).date().isoformat()
    queries = source_cfg.get("queries") or [
        "machine learning",
        "large language model",
        "computer vision",
        "reinforcement learning",
    ]
    per_query = min(100, int(source_cfg.get("per_query", 20)))
    keywords = config["interest_keywords"]
    api_key = os.environ.get("OPENALEX_API_KEY", "").strip()
    items: list[dict[str, Any]] = []

    for query in queries:
        params: dict[str, Any] = {
            "search": query,
            "filter": f"from_publication_date:{since}",
            "sort": "publication_date:desc",
            "per_page": per_query,
        }
        if api_key:
            params["api_key"] = api_key
        try:
            payload = get_json("https://api.openalex.org/works", params=params)
            for work in payload.get("results", []):
                title = strip_html(work.get("title") or work.get("display_name") or "Untitled")
                summary = strip_html(reconstruct_openalex_abstract(work.get("abstract_inverted_index")))
                authors = [
                    strip_html((authorship.get("author") or {}).get("display_name", ""))
                    for authorship in (work.get("authorships") or [])
                    if (authorship.get("author") or {}).get("display_name")
                ]
                primary = work.get("primary_location") or {}
                doi = clean_doi(work.get("doi"))
                url = primary.get("landing_page_url") or (f"https://doi.org/{doi}" if doi else work.get("id", ""))
                arxiv_id = arxiv_id_from_url(url)
                external_ids = {}
                if arxiv_id:
                    external_ids["arxiv"] = arxiv_id
                if doi:
                    external_ids["doi"] = doi
                topics = [
                    strip_html(topic.get("display_name", ""))
                    for topic in (work.get("topics") or [])[:4]
                    if topic.get("display_name")
                ]
                matched = keyword_tags(f"{title} {summary} {' '.join(topics)}", keywords)
                identity = paper_identity({"title": title, "external_ids": external_ids, "url": url})
                pdf_url = ((work.get("best_oa_location") or {}).get("pdf_url") or primary.get("pdf_url"))
                items.append({
                    "id": paper_id_from_identity(identity),
                    "title": title,
                    "url": url,
                    "source": "OpenAlex",
                    "sources": ["OpenAlex"],
                    "published": normalize_date(work.get("publication_date")),
                    "summary": truncate(summary, 430),
                    "authors": authors,
                    "tags": (matched + topics)[:5],
                    "external_ids": external_ids,
                    "metrics": {"citation_count": int(work.get("cited_by_count") or 0)},
                    "pdf_url": pdf_url,
                })
        except Exception as exc:
            print(f"[papers] OpenAlex ({query}): {exc}")

    return items

def merge_unique(values_a: list[Any] | None, values_b: list[Any] | None, limit: int | None = None) -> list[Any]:
    values = []
    seen = set()
    for value in (values_a or []) + (values_b or []):
        marker = json.dumps(value, sort_keys=True) if isinstance(value, (dict, list)) else str(value).lower()
        if value and marker not in seen:
            seen.add(marker)
            values.append(value)
        if limit and len(values) >= limit:
            break
    return values


def merge_paper_records(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    # Prefer Hugging Face as the landing page when available because it exposes the curated
    # Daily Papers context, while preserving every discovery source for filtering/badges.
    merged = dict(existing)
    sources = merge_unique(existing.get("sources") or [existing.get("source")], incoming.get("sources") or [incoming.get("source")])
    merged["sources"] = sources
    if "Hugging Face Papers" in sources:
        merged["source"] = "Hugging Face Papers"
        hf_record = incoming if incoming.get("source") == "Hugging Face Papers" else existing
        if hf_record.get("url"):
            merged["url"] = hf_record["url"]
    else:
        merged["source"] = existing.get("source") or incoming.get("source")
        if not merged.get("url"):
            merged["url"] = incoming.get("url", "")

    # Keep the richest text/author metadata.
    if len(incoming.get("summary", "")) > len(merged.get("summary", "")):
        merged["summary"] = incoming.get("summary", "")
    if len(incoming.get("authors", [])) > len(merged.get("authors", [])):
        merged["authors"] = incoming.get("authors", [])
    if not merged.get("title") or merged.get("title") == "Untitled":
        merged["title"] = incoming.get("title", merged.get("title"))

    merged["tags"] = merge_unique(existing.get("tags"), incoming.get("tags"), limit=7)
    merged["external_ids"] = {**existing.get("external_ids", {}), **incoming.get("external_ids", {})}
    merged["metrics"] = {**existing.get("metrics", {}), **incoming.get("metrics", {})}

    # Publication date should describe the paper itself, not when a discovery service indexed it.
    dates = [d for d in (existing.get("published"), incoming.get("published")) if d]
    if dates:
        merged["published"] = min(dates)

    for field in ("pdf_url", "project_page", "github_repo"):
        if not merged.get(field) and incoming.get(field):
            merged[field] = incoming[field]
    return merged


def merge_papers(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: dict[str, dict[str, Any]] = {}
    title_index: dict[str, str] = {}

    for item in items:
        identity = paper_identity(item)
        title_key = normalized_title(item.get("title"))
        # Exact identifiers are strongest. A normalized title is a fallback for providers that
        # omitted DOI/arXiv identifiers.
        key = identity
        if title_key and title_key in title_index and title_index[title_key] != key:
            prior_key = title_index[title_key]
            if prior_key.startswith("title:") and not key.startswith("title:"):
                # Upgrade an identifier-poor record to the stronger DOI/arXiv key.
                previous = unique.pop(prior_key)
                unique[key] = merge_paper_records(previous, item)
                title_index[title_key] = key
                unique[key]["id"] = paper_id_from_identity(key)
                continue
            # Exact normalized-title matches are safe enough for this recent rolling feed and
            # catch cases where one index knows a DOI while another only knows arXiv metadata.
            key = prior_key

        if key in unique:
            unique[key] = merge_paper_records(unique[key], item)
        else:
            item = dict(item)
            item["id"] = paper_id_from_identity(key)
            item["sources"] = merge_unique(item.get("sources") or [item.get("source")], [])
            unique[key] = item
        if title_key:
            title_index[title_key] = key

    return sorted(unique.values(), key=lambda x: x.get("published", ""), reverse=True)


def fetch_papers(config: dict[str, Any]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    candidates.extend(fetch_arxiv_papers(config))
    candidates.extend(fetch_huggingface_papers(config))
    candidates.extend(fetch_semantic_scholar_papers(config))
    candidates.extend(fetch_openalex_papers(config))
    return merge_papers(candidates)[: config["limits"]["papers"]]


def dedupe_sort(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: dict[str, dict[str, Any]] = {}
    for item in items:
        key = item.get("url") or item.get("id")
        if key and key not in unique:
            unique[key] = item
    return sorted(unique.values(), key=lambda x: x.get("published", ""), reverse=True)


def main() -> None:
    config = load_config()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    videos = fetch_videos(config, limit=False)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "papers": fetch_papers(config),
        "blogs": fetch_blogs(config),
        "videos": videos[: config["limits"]["videos"]],
        "channel_videos": videos,
    }
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH}")
    print({k: len(v) for k, v in payload.items() if isinstance(v, list)})


if __name__ == "__main__":
    main()
