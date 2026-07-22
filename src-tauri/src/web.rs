//! OpenCode-inspired websearch + webfetch (Rust).
//! - DuckDuckGo HTML search (no API key)
//! - WebFetch: 5MB cap, timeout, Chrome UA + 403 retry, main-content extract, HTML→Markdown

use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

const MAX_RESPONSE_SIZE: usize = 5 * 1024 * 1024; // 5MB — same as OpenCode
const DEFAULT_TIMEOUT_SECS: u64 = 30;
// MCP services are only the first search tier. Do not let an unavailable service
// delay all of the direct search fallbacks for the full request timeout.
const MCP_TIMEOUT_SECS: u64 = 8;
const MAX_TIMEOUT_SECS: u64 = 120;

const UA_CHROME: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";
const UA_SIMPLE: &str = "flux/0.1 (compatible; webfetch)";

#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Debug, Clone)]
pub struct WebRuntime {
    /// bing | google | auto
    pub engine: String,
    pub proxy_url: String,
    pub proxy_for_google: bool,
}

impl Default for WebRuntime {
    fn default() -> Self {
        Self {
            engine: "auto".into(),
            proxy_url: "http://127.0.0.1:10808".into(),
            proxy_for_google: true,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchOutcome {
    pub hits: Vec<SearchHit>,
    /// bing | google
    pub engine_used: String,
    pub note: String,
}

static PROXY_CACHE: Mutex<Option<(bool, Instant, String)>> = Mutex::new(None);
static DIRECT_CLIENT: LazyLock<Result<reqwest::Client, String>> =
    LazyLock::new(|| build_client(None));
static PROXY_CLIENTS: LazyLock<Mutex<HashMap<String, reqwest::Client>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static RE_SCRIPT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<script\b[^>]*>.*?</script>").unwrap());
static RE_STYLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<style\b[^>]*>.*?</style>").unwrap());
static RE_NOSCRIPT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<noscript\b[^>]*>.*?</noscript>").unwrap());
static RE_SVG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<svg\b[^>]*>.*?</svg>").unwrap());
static RE_COMMENT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<!--.*?-->").unwrap());
static RE_NAV: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<nav\b[^>]*>.*?</nav>").unwrap());
static RE_FOOTER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<footer\b[^>]*>.*?</footer>").unwrap());
static RE_HEADER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<header\b[^>]*>.*?</header>").unwrap());
static RE_ASIDE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<aside\b[^>]*>.*?</aside>").unwrap());
static RE_FORM: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<form\b[^>]*>.*?</form>").unwrap());
static RE_ARTICLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?is)<article\b[^>]*>(.*?)</article>"#).unwrap());
static RE_MAIN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?is)<main\b[^>]*>(.*?)</main>"#).unwrap());
static RE_BODY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?is)<body\b[^>]*>(.*?)</body>"#).unwrap());
static RE_TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]+>").unwrap());
static RE_H: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?is)<h([1-6])\b[^>]*>(.*?)</h[1-6]>"#).unwrap());
static RE_P: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?is)<p\b[^>]*>(.*?)</p>"#).unwrap());
static RE_LI: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?is)<li\b[^>]*>(.*?)</li>"#).unwrap());
static RE_PRE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?is)<pre\b[^>]*>(.*?)</pre>"#).unwrap());
static RE_CODE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?is)<code\b[^>]*>(.*?)</code>"#).unwrap());
static RE_A: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>(.*?)</a>"#).unwrap()
});
static RE_IMG: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)<img\b[^>]*alt\s*=\s*["']([^"']*)["'][^>]*/?>|<img\b[^>]*/?>"#).unwrap()
});
static RE_BR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)<br\s*/?>").unwrap());
static RE_HR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)<hr\s*/?>").unwrap());
static RE_BQ: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?is)<blockquote\b[^>]*>(.*?)</blockquote>"#).unwrap());
static RE_STRONG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?is)<(?:strong|b)\b[^>]*>(.*?)</(?:strong|b)>"#).unwrap());
static RE_EM: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?is)<(?:em|i)\b[^>]*>(.*?)</(?:em|i)>"#).unwrap());
static RE_WS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[ \t\x0b\x0c\r]+").unwrap());
static RE_NL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\n{3,}").unwrap());

fn port_open(host: &str, port: u16) -> bool {
    use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
    let ok = format!("{host}:{port}")
        .to_socket_addrs()
        .ok()
        .and_then(|mut a| a.next());
    let Some(addr) = ok else {
        return false;
    };
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
        || TcpStream::connect_timeout(
            &SocketAddr::from(([127, 0, 0, 1], port)),
            Duration::from_millis(200),
        )
        .is_ok()
}

fn parse_proxy_host_port(proxy_url: &str) -> Option<(String, u16)> {
    let u = proxy_url.trim();
    let rest = u
        .strip_prefix("http://")
        .or_else(|| u.strip_prefix("https://"))
        .or_else(|| u.strip_prefix("socks5://"))
        .unwrap_or(u);
    let rest = rest.split('/').next().unwrap_or(rest);
    let (host, port_s) = if let Some((h, p)) = rest.rsplit_once(':') {
        (h, p)
    } else {
        return Some((rest.to_string(), 80));
    };
    let port: u16 = port_s.parse().ok()?;
    Some((host.to_string(), port))
}

/// Cached TCP probe of proxy (10s).
pub fn proxy_available(proxy_url: &str) -> bool {
    let key = proxy_url.trim().to_string();
    if let Ok(guard) = PROXY_CACHE.lock() {
        if let Some((ok, at, ref cached)) = *guard {
            if cached == &key && at.elapsed() < Duration::from_secs(15) {
                return ok;
            }
        }
    }
    let ok = parse_proxy_host_port(&key)
        .map(|(h, p)| port_open(&h, p))
        .unwrap_or(false);
    if let Ok(mut guard) = PROXY_CACHE.lock() {
        *guard = Some((ok, Instant::now(), key));
    }
    ok
}

fn build_client(proxy_url: Option<&str>) -> Result<reqwest::Client, String> {
    let mut b = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::limited(10))
        .pool_max_idle_per_host(2);
    if let Some(pu) = proxy_url.map(str::trim).filter(|s| !s.is_empty()) {
        let p = reqwest::Proxy::all(pu).map_err(|e| format!("invalid proxy: {e}"))?;
        b = b.proxy(p);
    } else {
        b = b.no_proxy();
    }
    b.build().map_err(|e| e.to_string())
}

fn client_direct() -> Result<reqwest::Client, String> {
    DIRECT_CLIENT.as_ref().cloned().map_err(Clone::clone)
}

fn client_proxied(proxy_url: &str) -> Result<reqwest::Client, String> {
    let key = proxy_url.trim();
    if key.is_empty() {
        return client_direct();
    }
    if let Some(client) = PROXY_CLIENTS
        .lock()
        .map_err(|e| e.to_string())?
        .get(key)
        .cloned()
    {
        return Ok(client);
    }
    let client = build_client(Some(key))?;
    PROXY_CLIENTS
        .lock()
        .map_err(|e| e.to_string())?
        .insert(key.to_string(), client.clone());
    Ok(client)
}

fn decode_html_entities(s: &str) -> String {
    let mut out = s
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
        .replace("&apos;", "'")
        .replace("&mdash;", "—")
        .replace("&ndash;", "–")
        .replace("&hellip;", "…")
        .replace("&rsquo;", "’")
        .replace("&lsquo;", "‘")
        .replace("&rdquo;", "”")
        .replace("&ldquo;", "“");
    // numeric &#NNN; / &#xHH;
    let re_num = Regex::new(r"&#(\d+);").unwrap();
    out = re_num
        .replace_all(&out, |c: &regex::Captures| {
            c.get(1)
                .and_then(|m| m.as_str().parse::<u32>().ok())
                .and_then(char::from_u32)
                .map(|ch| ch.to_string())
                .unwrap_or_default()
        })
        .to_string();
    let re_hex = Regex::new(r"&#x([0-9a-fA-F]+);").unwrap();
    out = re_hex
        .replace_all(&out, |c: &regex::Captures| {
            c.get(1)
                .and_then(|m| u32::from_str_radix(m.as_str(), 16).ok())
                .and_then(char::from_u32)
                .map(|ch| ch.to_string())
                .unwrap_or_default()
        })
        .to_string();
    out
}

fn strip_tags(s: &str) -> String {
    decode_html_entities(&RE_TAG.replace_all(s, ""))
        .trim()
        .to_string()
}

fn collapse_ws(s: &str) -> String {
    let t = RE_WS.replace_all(s, " ");
    RE_NL.replace_all(&t, "\n\n").trim().to_string()
}

// ─── Search (DDG) ─────────────────────────────────────────────

/// Parse MCP JSON-RPC response → extract text content
fn parse_mcp_response(body: &str) -> Result<String, String> {
    // MCP returns either direct JSON or SSE stream
    if body.trim().starts_with("{") {
        if let Ok(v) = serde_json::from_str::<Value>(body.trim()) {
            if let Some(text) = v
                .pointer("/result/content")
                .and_then(|c| c.as_array())
                .and_then(|arr| arr.first())
                .and_then(|item| item.get("text"))
                .and_then(|t| t.as_str())
            {
                return Ok(text.to_string());
            }
            // maybe it's an error
            if let Some(err) = v
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
            {
                return Err(err.to_string());
            }
        }
    }
    // SSE stream — find data: lines with result
    for line in body.lines() {
        if let Some(data) = line.strip_prefix("data: ") {
            if let Ok(v) = serde_json::from_str::<Value>(data.trim()) {
                if let Some(text) = v
                    .pointer("/result/content")
                    .and_then(|c| c.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|item| item.get("text"))
                    .and_then(|t| t.as_str())
                {
                    return Ok(text.to_string());
                }
            }
        }
    }
    // fallback: return raw (truncated)
    if body.len() > 200 {
        Err(format!("MCP: unparseable response ({} bytes)", body.len()))
    } else {
        Err(format!("MCP: {body}"))
    }
}

/// Search via Exa MCP — returns raw text result (already contains page content)
pub async fn search_exa_mcp(query: &str, num_results: usize) -> Result<Vec<SearchHit>, String> {
    let url = "https://mcp.exa.ai/mcp";
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "web_search_exa",
            "arguments": {
                "query": query,
                "type": "auto",
                "numResults": num_results,
                "livecrawl": "fallback"
            }
        }
    });
    let resp = client_direct()?
        .post(url)
        .timeout(Duration::from_secs(MCP_TIMEOUT_SECS))
        .header("Accept", "application/json, text/event-stream")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("exa: {e}"))?;
    if !resp.status().is_success() {
        let s = resp.status();
        let t = resp.text().await.unwrap_or_default();
        return Err(format!("exa: HTTP {s}: {t}"));
    }
    let text = resp.text().await.map_err(|e| format!("exa: {e}"))?;
    let content = parse_mcp_response(&text)?;
    // Exa returns a formatted text with results — return as single hit with full content
    Ok(vec![SearchHit {
        title: format!("Exa: {}", query),
        url: "https://exa.ai".into(),
        snippet: content.chars().take(8000).collect(),
    }])
}

/// Search via Parallel MCP
pub async fn search_parallel_mcp(query: &str) -> Result<Vec<SearchHit>, String> {
    let url = "https://search.parallel.ai/mcp";
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "web_search",
            "arguments": {
                "objective": query,
                "search_queries": [query]
            }
        }
    });
    let resp = client_direct()?
        .post(url)
        .timeout(Duration::from_secs(MCP_TIMEOUT_SECS))
        .header("Accept", "application/json, text/event-stream")
        .header("Content-Type", "application/json")
        .header("User-Agent", "flux/0.1")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("parallel: {e}"))?;
    if !resp.status().is_success() {
        let s = resp.status();
        let t = resp.text().await.unwrap_or_default();
        return Err(format!("parallel: HTTP {s}: {t}"));
    }
    let text = resp.text().await.map_err(|e| format!("parallel: {e}"))?;
    let content = parse_mcp_response(&text)?;
    Ok(vec![SearchHit {
        title: format!("Parallel: {}", query),
        url: "https://parallel.ai".into(),
        snippet: content.chars().take(8000).collect(),
    }])
}
pub async fn web_search(
    query: &str,
    limit: usize,
    rt: &WebRuntime,
) -> Result<SearchOutcome, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(SearchOutcome {
            hits: vec![],
            engine_used: "none".into(),
            note: "empty".into(),
        });
    }
    let limit = limit.clamp(1, 8);

    // Race the two content-rich MCP providers. Previously they ran serially, so
    // one unavailable service could hold every search for 30 seconds before the
    // next provider and the direct-engine fallbacks were even attempted.
    let exa = search_exa_mcp(q, limit);
    let parallel = search_parallel_mcp(q);
    futures_util::pin_mut!(exa, parallel);
    match futures_util::future::select(exa, parallel).await {
        futures_util::future::Either::Left((exa_result, parallel_future)) => {
            match exa_result {
                Ok(hits) if !hits.is_empty() => {
                    return Ok(SearchOutcome {
                        hits,
                        engine_used: "exa".into(),
                        note: "Exa MCP".into(),
                    });
                }
                Ok(_) => {}
                Err(e) => eprintln!("exa: {e}"),
            }
            match parallel_future.await {
                Ok(hits) if !hits.is_empty() => {
                    return Ok(SearchOutcome {
                        hits,
                        engine_used: "parallel".into(),
                        note: "Parallel MCP".into(),
                    });
                }
                Ok(_) => {}
                Err(e) => eprintln!("parallel: {e}"),
            }
        }
        futures_util::future::Either::Right((parallel_result, exa_future)) => {
            match parallel_result {
                Ok(hits) if !hits.is_empty() => {
                    return Ok(SearchOutcome {
                        hits,
                        engine_used: "parallel".into(),
                        note: "Parallel MCP".into(),
                    });
                }
                Ok(_) => {}
                Err(e) => eprintln!("parallel: {e}"),
            }
            match exa_future.await {
                Ok(hits) if !hits.is_empty() => {
                    return Ok(SearchOutcome {
                        hits,
                        engine_used: "exa".into(),
                        note: "Exa MCP".into(),
                    });
                }
                Ok(_) => {}
                Err(e) => eprintln!("exa: {e}"),
            }
        }
    }

    // 3. Fallback: Bing/Google (existing)
    let eng = rt.engine.trim().to_ascii_lowercase();
    let proxy_ok = rt.proxy_for_google && proxy_available(&rt.proxy_url);

    match eng.as_str() {
        "bing" => {
            let hits = search_bing(q, limit, false, &rt.proxy_url).await?;
            Ok(SearchOutcome {
                hits,
                engine_used: "bing".into(),
                note: "Bing（直连）".into(),
            })
        }
        "google" => {
            if !proxy_ok {
                // recommended: fall back with note
                let hits = search_bing(q, limit, false, &rt.proxy_url).await?;
                return Ok(SearchOutcome {
                    hits,
                    engine_used: "bing".into(),
                    note: "Google 需要代理，已回退 Bing".into(),
                });
            }
            match search_google(q, limit, &rt.proxy_url).await {
                Ok(hits) if !hits.is_empty() => Ok(SearchOutcome {
                    hits,
                    engine_used: "google".into(),
                    note: format!("Google（代理 {}）", rt.proxy_url),
                }),
                Ok(_) => {
                    let hits = search_bing(q, limit, false, &rt.proxy_url).await?;
                    Ok(SearchOutcome {
                        hits,
                        engine_used: "bing".into(),
                        note: "Google 无结果，已回退 Bing".into(),
                    })
                }
                Err(e) => {
                    let hits = search_bing(q, limit, false, &rt.proxy_url).await?;
                    Ok(SearchOutcome {
                        hits,
                        engine_used: "bing".into(),
                        note: format!("Google 失败（{e}），已回退 Bing"),
                    })
                }
            }
        }
        // auto
        _ => {
            if proxy_ok {
                match search_google(q, limit, &rt.proxy_url).await {
                    Ok(hits) if !hits.is_empty() => {
                        return Ok(SearchOutcome {
                            hits,
                            engine_used: "google".into(),
                            note: format!("Google（代理 {}）", rt.proxy_url),
                        });
                    }
                    Ok(_) => {}
                    Err(_) => {}
                }
            }
            match search_bing(q, limit, false, &rt.proxy_url).await {
                Ok(hits) if !hits.is_empty() => {
                    let note = if proxy_ok {
                        "Bing（Google 不可用/无结果）".to_string()
                    } else {
                        "Bing（代理不可用）".to_string()
                    };
                    return Ok(SearchOutcome {
                        hits,
                        engine_used: "bing".into(),
                        note,
                    });
                }
                _ => {}
            }
            // last resort: DDG
            let url = format!(
                "https://html.duckduckgo.com/html/?q={}",
                urlencoding_lite(q)
            );
            if let Ok(html) = fetch_html(&url, proxy_ok, &rt.proxy_url).await {
                let hits = parse_ddg_html(&html, limit).unwrap_or_default();
                if !hits.is_empty() {
                    return Ok(SearchOutcome {
                        hits,
                        engine_used: "ddg".into(),
                        note: "DuckDuckGo（备用）".into(),
                    });
                }
            }
            Err("所有搜索引擎均失败".into())
        }
    }
}

async fn fetch_html(url: &str, use_proxy: bool, proxy_url: &str) -> Result<String, String> {
    let c = if use_proxy {
        client_proxied(proxy_url)?
    } else {
        client_direct()?
    };
    let resp = c
        .get(url)
        .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
        .header("User-Agent", UA_CHROME)
        .header("Accept", "text/html,application/xhtml+xml")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let t = resp.text().await.map_err(|e| e.to_string())?;
    if t.len() < 80 {
        return Err("short body".into());
    }
    Ok(t)
}

async fn search_bing(
    q: &str,
    limit: usize,
    use_proxy: bool,
    proxy_url: &str,
) -> Result<Vec<SearchHit>, String> {
    let url = format!(
        "https://www.bing.com/search?q={}&setlang=zh-CN",
        urlencoding_lite(q)
    );
    let html = fetch_html(&url, use_proxy, proxy_url).await?;
    parse_bing_html(&html, limit)
}

async fn search_google(q: &str, limit: usize, proxy_url: &str) -> Result<Vec<SearchHit>, String> {
    let url = format!(
        "https://www.google.com/search?q={}&hl=zh-CN&num={}",
        urlencoding_lite(q),
        limit
    );
    let html = fetch_html(&url, true, proxy_url).await?;
    parse_google_html(&html, limit)
}

fn parse_google_html(html: &str, limit: usize) -> Result<Vec<SearchHit>, String> {
    // Google organic: <a href="/url?q=https://..."> or direct https in result blocks
    let mut hits = Vec::new();
    let re = Regex::new(
        r#"<a[^>]+href="(?:/url\?q=)?(https?://[^"&]+)[^"]*"[^>]*>.*?<h3[^>]*>(.*?)</h3>"#,
    )
    .map_err(|e| e.to_string())?;
    for cap in re.captures_iter(html) {
        let mut href = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
        if let Ok(d) = urlencoding_decode(&href) {
            if d.starts_with("http") {
                href = d;
            }
        }
        let title = strip_tags(cap.get(2).map(|m| m.as_str()).unwrap_or(""));
        if href.contains("google.com") || href.contains("webcache") {
            continue;
        }
        if href.is_empty() || title.is_empty() {
            continue;
        }
        hits.push(SearchHit {
            title,
            url: href,
            snippet: String::new(),
        });
        if hits.len() >= limit {
            break;
        }
    }
    if hits.is_empty() {
        // fallback looser anchors
        let re2 = Regex::new(r#"href="(https?://[^"]+)"[^>]*>\s*<h3[^>]*>(.*?)</h3>"#)
            .map_err(|e| e.to_string())?;
        for cap in re2.captures_iter(html) {
            let href = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
            let title = strip_tags(cap.get(2).map(|m| m.as_str()).unwrap_or(""));
            if href.contains("google.") || title.is_empty() {
                continue;
            }
            hits.push(SearchHit {
                title,
                url: href,
                snippet: String::new(),
            });
            if hits.len() >= limit {
                break;
            }
        }
    }
    Ok(hits)
}

fn parse_bing_html(html: &str, limit: usize) -> Result<Vec<SearchHit>, String> {
    let re = Regex::new(
        r#"(?s)<li[^>]*class="b_algo"[^>]*>.*?<h2[^>]*>\s*<a[^>]+href="(https?://[^"]+)"[^>]*>(.*?)</a>"#,
    )
    .map_err(|e| e.to_string())?;
    let mut hits = Vec::new();
    for cap in re.captures_iter(html) {
        let href = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
        let title = strip_tags(cap.get(2).map(|m| m.as_str()).unwrap_or(""));
        if href.is_empty() || title.is_empty() {
            continue;
        }
        hits.push(SearchHit {
            title,
            url: href,
            snippet: String::new(),
        });
        if hits.len() >= limit {
            break;
        }
    }
    if hits.is_empty() {
        let re2 = Regex::new(r#"(?s)<h2[^>]*>\s*<a[^>]+href="(https?://[^"]+)"[^>]*>(.*?)</a>"#)
            .map_err(|e| e.to_string())?;
        for cap in re2.captures_iter(html) {
            let href = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
            let title = strip_tags(cap.get(2).map(|m| m.as_str()).unwrap_or(""));
            if href.contains("microsoft.com") || href.contains("bing.com") {
                continue;
            }
            if href.is_empty() || title.is_empty() {
                continue;
            }
            hits.push(SearchHit {
                title,
                url: href,
                snippet: String::new(),
            });
            if hits.len() >= limit {
                break;
            }
        }
    }
    Ok(hits)
}

fn parse_ddg_html(html: &str, limit: usize) -> Result<Vec<SearchHit>, String> {
    let block_re = Regex::new(
        r#"(?s)class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>.*?(?:class="result__snippet"[^>]*>(.*?)</(?:a|td)>|)"#,
    )
    .map_err(|e| e.to_string())?;

    let mut hits = Vec::new();
    for cap in block_re.captures_iter(html) {
        let mut href = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
        let title = strip_tags(cap.get(2).map(|m| m.as_str()).unwrap_or(""));
        let snippet = strip_tags(cap.get(3).map(|m| m.as_str()).unwrap_or(""));
        href = normalize_ddg_url(&href);
        if !href.starts_with("http://") && !href.starts_with("https://") {
            continue;
        }
        if title.is_empty() {
            continue;
        }
        hits.push(SearchHit {
            title,
            url: href,
            snippet,
        });
        if hits.len() >= limit {
            break;
        }
    }

    if hits.is_empty() {
        let a_re = Regex::new(r#"class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>"#)
            .map_err(|e| e.to_string())?;
        for cap in a_re.captures_iter(html) {
            let mut href = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
            let title = strip_tags(cap.get(2).map(|m| m.as_str()).unwrap_or(""));
            href = normalize_ddg_url(&href);
            if !href.starts_with("http") || title.is_empty() {
                continue;
            }
            hits.push(SearchHit {
                title,
                url: href,
                snippet: String::new(),
            });
            if hits.len() >= limit {
                break;
            }
        }
    }

    Ok(hits)
}

fn normalize_ddg_url(href: &str) -> String {
    let mut href = href.to_string();
    if let Some(idx) = href.find("uddg=") {
        let rest = &href[idx + 5..];
        let enc = rest.split('&').next().unwrap_or(rest);
        if let Ok(u) = urlencoding_decode(enc) {
            href = u;
        }
    }
    if href.starts_with("//") {
        href = format!("https:{href}");
    }
    href
}

// ─── WebFetch (OpenCode-style) ────────────────────────────────

/// Fetch URL → markdown/text. Uses proxy when available (Google path), else direct.
pub async fn web_fetch(url: &str, max_chars: usize, rt: &WebRuntime) -> Result<String, String> {
    web_fetch_ex(url, max_chars, DEFAULT_TIMEOUT_SECS, rt).await
}

pub async fn web_fetch_ex(
    url: &str,
    max_chars: usize,
    timeout_secs: u64,
    rt: &WebRuntime,
) -> Result<String, String> {
    let u = url.trim();
    if !u.starts_with("http://") && !u.starts_with("https://") {
        return Err("URL must start with http:// or https://".into());
    }

    let timeout = timeout_secs.clamp(5, MAX_TIMEOUT_SECS);
    let accept =
        "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";

    let prefer_proxy = rt.proxy_for_google && proxy_available(&rt.proxy_url);
    let mut last_err = String::new();

    for (use_proxy, ua) in [
        (prefer_proxy, UA_CHROME),
        (prefer_proxy, UA_SIMPLE),
        (false, UA_CHROME),
        (false, UA_SIMPLE),
    ] {
        let c = if use_proxy {
            match client_proxied(&rt.proxy_url) {
                Ok(c) => c,
                Err(e) => {
                    last_err = e;
                    continue;
                }
            }
        } else {
            client_direct()?
        };

        let resp = match c
            .get(u)
            .timeout(Duration::from_secs(timeout))
            .header("User-Agent", ua)
            .header("Accept", accept)
            .header("Accept-Language", "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7")
            .header("Cache-Control", "no-cache")
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                last_err = e.to_string();
                continue;
            }
        };

        if resp.status().as_u16() == 403 {
            last_err = "HTTP 403".into();
            continue;
        }
        if !resp.status().is_success() {
            last_err = format!("HTTP {}", resp.status());
            continue;
        }

        // success path — fall through using this resp
        return finish_fetch(resp, max_chars).await;
    }

    Err(if last_err.is_empty() {
        "fetch failed".into()
    } else {
        last_err
    })
}

async fn finish_fetch(resp: reqwest::Response, max_chars: usize) -> Result<String, String> {
    if let Some(cl) = resp.headers().get(reqwest::header::CONTENT_LENGTH) {
        if let Ok(s) = cl.to_str() {
            if let Ok(n) = s.parse::<usize>() {
                if n > MAX_RESPONSE_SIZE {
                    return Err("Response too large (exceeds 5MB limit)".into());
                }
            }
        }
    }

    let ctype = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_RESPONSE_SIZE {
        return Err("Response too large (exceeds 5MB limit)".into());
    }

    // skip binary / images
    if ctype.starts_with("image/")
        || ctype.starts_with("audio/")
        || ctype.starts_with("video/")
        || ctype.contains("octet-stream")
        || ctype.contains("pdf")
    {
        return Err(format!("Unsupported content-type: {ctype}"));
    }

    let content = String::from_utf8_lossy(&bytes).to_string();
    let text = if ctype.contains("text/html")
        || ctype.contains("application/xhtml")
        || content.trim_start().starts_with('<')
    {
        html_to_markdown(&content)
    } else if ctype.contains("markdown") || ctype.contains("text/plain") {
        content
    } else {
        // try markdown conversion if looks like html
        if content.contains("</html>") || content.contains("<body") {
            html_to_markdown(&content)
        } else {
            content
        }
    };

    let mut out = collapse_ws(&text);
    if out.chars().count() > max_chars {
        out = out.chars().take(max_chars).collect::<String>() + "\n\n…";
    }
    if out.trim().is_empty() {
        out = "(empty page)".into();
    }
    Ok(out)
}

/// Prefer article/main, strip chrome, convert to markdown.
fn html_to_markdown(html: &str) -> String {
    let mut s = html.to_string();
    s = RE_COMMENT.replace_all(&s, " ").to_string();
    s = RE_SCRIPT.replace_all(&s, " ").to_string();
    s = RE_STYLE.replace_all(&s, " ").to_string();
    s = RE_NOSCRIPT.replace_all(&s, " ").to_string();
    s = RE_SVG.replace_all(&s, " ").to_string();

    // extract main content first
    let core = extract_main_html(&s);
    let mut s = core;

    // remove remaining chrome inside
    s = RE_NAV.replace_all(&s, " ").to_string();
    s = RE_FOOTER.replace_all(&s, " ").to_string();
    s = RE_HEADER.replace_all(&s, " ").to_string();
    s = RE_ASIDE.replace_all(&s, " ").to_string();
    s = RE_FORM.replace_all(&s, " ").to_string();

    // structural → markdown (order matters)
    s = RE_PRE
        .replace_all(&s, |c: &regex::Captures| {
            let inner = strip_tags(c.get(1).map(|m| m.as_str()).unwrap_or(""));
            format!("\n\n```\n{inner}\n```\n\n")
        })
        .to_string();

    s = RE_H
        .replace_all(&s, |c: &regex::Captures| {
            let level: usize = c
                .get(1)
                .and_then(|m| m.as_str().parse().ok())
                .unwrap_or(2)
                .clamp(1, 6);
            let inner = strip_tags(c.get(2).map(|m| m.as_str()).unwrap_or(""));
            let hashes = "#".repeat(level);
            format!("\n\n{hashes} {inner}\n\n")
        })
        .to_string();

    s = RE_BQ
        .replace_all(&s, |c: &regex::Captures| {
            let inner = strip_tags(c.get(1).map(|m| m.as_str()).unwrap_or(""));
            let quoted = inner
                .lines()
                .map(|l| format!("> {l}"))
                .collect::<Vec<_>>()
                .join("\n");
            format!("\n\n{quoted}\n\n")
        })
        .to_string();

    s = RE_LI
        .replace_all(&s, |c: &regex::Captures| {
            let inner = strip_tags(c.get(1).map(|m| m.as_str()).unwrap_or(""));
            format!("\n- {inner}")
        })
        .to_string();

    s = RE_P
        .replace_all(&s, |c: &regex::Captures| {
            let inner = c.get(1).map(|m| m.as_str()).unwrap_or("");
            // keep inline markup for next passes
            format!("\n\n{inner}\n\n")
        })
        .to_string();

    s = RE_A
        .replace_all(&s, |c: &regex::Captures| {
            let href = c.get(1).map(|m| m.as_str()).unwrap_or("");
            let text = strip_tags(c.get(2).map(|m| m.as_str()).unwrap_or(""));
            if text.is_empty() {
                href.to_string()
            } else if href.is_empty() {
                text
            } else {
                format!("[{text}]({href})")
            }
        })
        .to_string();

    s = RE_STRONG
        .replace_all(&s, |c: &regex::Captures| {
            let inner = strip_tags(c.get(1).map(|m| m.as_str()).unwrap_or(""));
            format!("**{inner}**")
        })
        .to_string();

    s = RE_EM
        .replace_all(&s, |c: &regex::Captures| {
            let inner = strip_tags(c.get(1).map(|m| m.as_str()).unwrap_or(""));
            format!("*{inner}*")
        })
        .to_string();

    s = RE_CODE
        .replace_all(&s, |c: &regex::Captures| {
            let inner = strip_tags(c.get(1).map(|m| m.as_str()).unwrap_or(""));
            format!("`{inner}`")
        })
        .to_string();

    s = RE_IMG
        .replace_all(&s, |c: &regex::Captures| {
            let alt = c.get(1).map(|m| m.as_str()).unwrap_or("image");
            if alt.is_empty() {
                String::new()
            } else {
                format!("![{alt}](...)")
            }
        })
        .to_string();

    s = RE_BR.replace_all(&s, "\n").to_string();
    s = RE_HR.replace_all(&s, "\n\n---\n\n").to_string();

    // remaining tags
    let text = strip_tags(&s);
    collapse_ws(&text)
}

/// Pull the densest meaningful region: article > main > body > full.
fn extract_main_html(html: &str) -> String {
    // longest article
    let mut best = String::new();
    for cap in RE_ARTICLE.captures_iter(html) {
        let inner = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        if inner.len() > best.len() {
            best = inner.to_string();
        }
    }
    if best.len() > 400 {
        return best;
    }

    if let Some(cap) = RE_MAIN.captures(html) {
        let inner = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
        if inner.len() > 400 {
            return inner;
        }
    }

    // role=main
    let re_role =
        Regex::new(r#"(?is)<[^>]+role\s*=\s*["']main["'][^>]*>(.*?)</[a-zA-Z0-9]+>"#).ok();
    if let Some(re) = re_role {
        if let Some(cap) = re.captures(html) {
            let inner = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
            if inner.len() > 400 {
                return inner;
            }
        }
    }

    if let Some(cap) = RE_BODY.captures(html) {
        return cap.get(1).map(|m| m.as_str()).unwrap_or(html).to_string();
    }
    html.to_string()
}

// ─── utils ────────────────────────────────────────────────────

fn urlencoding_lite(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn urlencoding_decode(s: &str) -> Result<String, ()> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = || {
                    let a = (bytes[i + 1] as char).to_digit(16)?;
                    let b = (bytes[i + 2] as char).to_digit(16)?;
                    Some((a * 16 + b) as u8)
                };
                if let Some(v) = hex() {
                    out.push(v);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8(out).map_err(|_| ())
}
