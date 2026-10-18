"""Fetch a web page or image for the importer without reaching private networks.

Only http and https on ports 80 and 443. Every address the host resolves to must be public.
The connection goes to the address that was checked, so a second DNS answer cannot change it.
Redirects are followed by hand, up to 3, and each one is checked again.
"""
import ipaddress
import socket
import threading
import time
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx

TIMEOUT = 10  # seconds, for the whole fetch
MAX_REDIRECTS = 3
MAX_PAGE = 3 * 1024 * 1024
MAX_IMAGE = 5 * 1024 * 1024
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
PAGE_ACCEPT = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"
IMAGE_ACCEPT = "image/jpeg,image/png,image/webp;q=0.9,*/*;q=0.5"
# IPv6 ranges that carry an IPv4 address in their last 32 bits: NAT64, IPv4-compatible, IPv4-translated.
EMBEDS_IPV4 = tuple(ipaddress.ip_network(n) for n in ("64:ff9b::/96", "::/96", "::ffff:0:0:0/96"))
TOO_SLOW = "The site took too long."


class FetchError(Exception):
    """The fetch failed. The message is readable."""


class BadUrl(FetchError):
    """The address is not valid, or not allowed."""


def resolve(host: str, port: int, timeout: float) -> list:
    """socket.getaddrinfo, but give up after timeout seconds. The lookup thread is left to finish alone."""
    result = {}

    def lookup():
        try:
            result["infos"] = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        except BaseException as e:
            result["error"] = e

    thread = threading.Thread(target=lookup, daemon=True)
    thread.start()
    thread.join(timeout)
    if thread.is_alive():
        raise FetchError(TOO_SLOW)
    if "error" in result:
        raise result["error"]
    return result["infos"]


def is_blocked(ip) -> bool:
    return bool(
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast
        or ip.is_reserved or ip.is_unspecified or not ip.is_global
    )


def public_address(host: str, port: int, timeout: float = TIMEOUT) -> str:
    """The first address of host, if all of its addresses are public. Raise BadUrl otherwise."""
    try:
        infos = resolve(host, port, timeout)
    except (socket.gaierror, UnicodeError, OSError):
        raise FetchError("Couldn't find that site.")
    addresses = []
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        checks = [ip]
        if isinstance(ip, ipaddress.IPv6Address) and any(ip in net for net in EMBEDS_IPV4):
            checks.append(ipaddress.IPv4Address(ip.packed[-4:]))
        if any(is_blocked(c) for c in checks):
            raise BadUrl("That address isn't allowed.")
        addresses.append(str(ip))
    if not addresses:
        raise FetchError("Couldn't find that site.")
    return addresses[0]


def check_url(url: str, timeout: float = TIMEOUT):
    """Split url and check it. Return (parts, address to connect to). Raise BadUrl."""
    try:
        parts = urlsplit(url)
        port = parts.port
        host = parts.hostname
    except ValueError:
        raise BadUrl("That link isn't valid.")
    if parts.scheme not in ("http", "https") or not host:
        raise BadUrl("That link isn't valid. Use an http or https address.")
    if "@" in parts.netloc:
        raise BadUrl("That address isn't allowed.")
    default = 443 if parts.scheme == "https" else 80
    if port not in (None, 80, 443):
        raise BadUrl("That address isn't allowed.")
    return parts, public_address(host, port or default, timeout)


def open_client() -> httpx.Client:
    return httpx.Client(timeout=TIMEOUT, follow_redirects=False, trust_env=False)


def fetch(url: str, max_bytes: int, accept: str = PAGE_ACCEPT) -> tuple[bytes, str, str]:
    """Download url. Return (body, content type, final url). Raise FetchError, or BadUrl for a bad address."""
    deadline = time.monotonic() + TIMEOUT

    def remaining() -> float:
        left = deadline - time.monotonic()
        if left <= 0:
            raise FetchError(TOO_SLOW)
        return min(TIMEOUT, left)

    headers = {
        "User-Agent": USER_AGENT, "Accept": accept, "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",  # so max_bytes counts the bytes that were received
    }
    for _ in range(MAX_REDIRECTS + 1):
        parts, address = check_url(url, remaining())
        host = f"[{address}]" if ":" in address else address
        if parts.port:
            host += f":{parts.port}"
        target = urlunsplit((parts.scheme, host, parts.path or "/", parts.query, ""))
        extensions = {"sni_hostname": parts.hostname} if parts.scheme == "https" else {}
        try:
            # A new client for every hop, so a pooled connection is never reused for another host name.
            with open_client() as client, client.stream(
                "GET", target, headers={**headers, "Host": parts.netloc}, extensions=extensions,
                timeout=remaining(),
            ) as response:
                if response.is_redirect:
                    url = urljoin(url, response.headers["location"])
                    continue
                if response.status_code != 200:
                    raise FetchError(f"The site answered with error {response.status_code}.")
                if response.headers.get("content-encoding", "identity").lower() != "identity":
                    raise FetchError("The site sent a bad answer.")
                if int(response.headers.get("content-length") or 0) > max_bytes:
                    raise FetchError("That file is too big.")
                body = bytearray()
                for chunk in response.iter_bytes():
                    remaining()
                    body += chunk
                    if len(body) > max_bytes:
                        raise FetchError("That file is too big.")
                return bytes(body), response.headers.get("content-type", ""), url
        except httpx.HTTPError:
            raise FetchError("Couldn't reach that site.")
        except ValueError:
            raise FetchError("The site sent a bad answer.")
    raise FetchError("The site redirected too many times.")
