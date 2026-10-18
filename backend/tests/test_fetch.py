import socket
import threading
import time
from types import SimpleNamespace

import httpx
import pytest

from otto_api import fetch
from otto_api.fetch import BadUrl, FetchError

PAGE = "http://example.com/sofa"


def ok(body=b"hello", **kwargs):
    return lambda request: httpx.Response(200, content=body, **kwargs)


def test_fetch_connects_to_the_checked_address(net):
    net.handler = ok(b"hello", headers={"content-type": "text/html"})
    body, kind, url = fetch.fetch(PAGE + "?a=1", 100)
    assert (body, kind, url) == (b"hello", "text/html", PAGE + "?a=1")
    request = net.calls[0]
    assert request.url.host == "93.184.216.34" and request.url.query == b"a=1"
    assert request.headers["host"] == "example.com"
    assert request.headers["accept-language"].startswith("en-US")
    assert request.headers["accept-encoding"] == "identity"
    assert "Mozilla/5.0" in request.headers["user-agent"]


def test_https_keeps_the_site_name_for_tls(net):
    net.handler = ok()
    fetch.fetch("https://example.com:443/x", 100)
    assert net.calls[0].extensions["sni_hostname"] == "example.com"
    assert net.calls[0].headers["host"] == "example.com:443"


@pytest.mark.parametrize("url", [
    "http://localhost/",
    "http://127.0.0.1/",
    "http://10.1.2.3/",
    "http://192.168.1.10/",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://mapped.test/",
    "http://0.0.0.0/",
    "http://224.0.0.1/",
    "http://[fe80::1]/",
    "http://[fd00::1]/",
    "http://[64:ff9b::7f00:1]/",  # NAT64 around 127.0.0.1
    "http://[64:ff9b::a9fe:a9fe]/",  # NAT64 around 169.254.169.254
    "http://[64:ff9b::a00:1]/",  # NAT64 around 10.0.0.1
    "http://[::7f00:1]/",  # IPv4-compatible 127.0.0.1
    "http://[::a9fe:a9fe]/",  # IPv4-compatible 169.254.169.254
    "http://[::ffff:0:7f00:1]/",  # IPv4-translated 127.0.0.1
    "http://[::ffff:0:c0a8:1]/",  # IPv4-translated 192.168.0.1
    "http://nat64.test/",
])
def test_private_addresses_are_blocked(net, url):
    net.hosts.update({
        "localhost": "127.0.0.1", "mapped.test": "::ffff:127.0.0.1", "nat64.test": "64:ff9b::c0a8:1",
    })
    with pytest.raises(BadUrl, match="isn't allowed"):
        fetch.fetch(url, 100)
    assert net.calls == []


def test_one_private_address_blocks_the_host(net, monkeypatch):
    def mixed(host, port, *args, **kwargs):
        return [(2, 1, 6, "", ("93.184.216.34", port)), (2, 1, 6, "", ("10.0.0.1", port))]

    monkeypatch.setattr(fetch.socket, "getaddrinfo", mixed)
    with pytest.raises(BadUrl):
        fetch.fetch(PAGE, 100)
    assert net.calls == []


@pytest.mark.parametrize("url", [
    "ftp://example.com/x",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "//example.com/x",
    "http://user:pw@example.com/",
    "http://user@example.com/",
    "http://example.com:8080/",
    "http://example.com:22/",
    "http://example.com:notaport/",
    "not a url",
])
def test_bad_urls_are_rejected(net, url):
    with pytest.raises(BadUrl):
        fetch.fetch(url, 100)
    assert net.calls == []


def test_unknown_host_is_a_fetch_error(net, monkeypatch):
    def fail(*args, **kwargs):
        raise socket.gaierror("no such host")

    monkeypatch.setattr(fetch.socket, "getaddrinfo", fail)
    with pytest.raises(FetchError) as e:
        fetch.fetch(PAGE, 100)
    assert not isinstance(e.value, BadUrl)


def test_redirects_are_followed_and_checked(net):
    def handler(request):
        if request.headers["host"] == "example.com":
            return httpx.Response(302, headers={"location": "https://shop.test/final"})
        return httpx.Response(200, content=b"done")

    net.handler = handler
    assert fetch.fetch(PAGE, 100)[::2] == (b"done", "https://shop.test/final")


def test_relative_redirect(net):
    net.handler = lambda r: (
        httpx.Response(301, headers={"location": "/b"}) if r.url.path == "/a" else httpx.Response(200, content=b"b")
    )
    assert fetch.fetch("http://example.com/a", 100)[2] == "http://example.com/b"


@pytest.mark.parametrize("target", [
    "http://127.0.0.1/admin", "http://169.254.169.254/", "http://[::1]/", "ftp://example.com/x",
    "http://user:pw@example.com/", "http://example.com:8080/",
])
def test_redirect_to_a_private_address_is_blocked(net, target):
    net.handler = lambda r: httpx.Response(302, headers={"location": target})
    with pytest.raises(BadUrl):
        fetch.fetch(PAGE, 100)
    assert len(net.calls) == 1


def test_too_many_redirects(net):
    net.handler = lambda r: httpx.Response(302, headers={"location": "/again"})
    with pytest.raises(FetchError, match="too many"):
        fetch.fetch(PAGE, 100)
    assert len(net.calls) == 4  # the first request and 3 redirects


def test_size_cap(net):
    net.handler = ok(b"x" * 11)
    with pytest.raises(FetchError, match="too big"):
        fetch.fetch(PAGE, 10)
    assert fetch.fetch(PAGE, 11)[0] == b"x" * 11


def test_size_cap_without_content_length(net):
    def chunks():
        for _ in range(5):
            yield b"xxxx"

    net.handler = lambda r: httpx.Response(200, content=chunks())
    with pytest.raises(FetchError, match="too big"):
        fetch.fetch(PAGE, 10)


def test_error_status_and_network_failure(net):
    net.handler = lambda r: httpx.Response(500)
    with pytest.raises(FetchError, match="500"):
        fetch.fetch(PAGE, 100)

    def boom(request):
        raise httpx.ConnectTimeout("slow", request=request)

    net.handler = boom
    with pytest.raises(FetchError, match="reach"):
        fetch.fetch(PAGE, 100)


def test_compressed_answer_is_refused(net):
    net.handler = lambda r: httpx.Response(200, content=iter([b"hello"]), headers={"content-encoding": "gzip"})
    with pytest.raises(FetchError, match="bad answer"):
        fetch.fetch(PAGE, 100)


def test_every_hop_gets_a_new_client(net, monkeypatch):
    clients = []
    real = fetch.open_client

    def counting():
        clients.append(real())
        return clients[-1]

    monkeypatch.setattr(fetch, "open_client", counting)
    net.handler = lambda r: (
        httpx.Response(302, headers={"location": "https://shop.test/b"}) if r.url.path == "/a" else httpx.Response(200)
    )
    fetch.fetch("http://example.com/a", 100)
    assert len(clients) == 2 and clients[0] is not clients[1]


class Clock:
    """A fake time.monotonic that only moves when the test moves it."""

    def __init__(self, monkeypatch):
        self.now = 1000.0
        monkeypatch.setattr(fetch, "time", SimpleNamespace(monotonic=lambda: self.now))


def test_slow_body_hits_the_overall_deadline(net, monkeypatch):
    clock = Clock(monkeypatch)
    sent = []

    def chunks():
        for _ in range(10):
            clock.now += 4
            sent.append(1)
            yield b"x"

    net.handler = lambda r: httpx.Response(200, content=chunks())
    with pytest.raises(FetchError, match="too long"):
        fetch.fetch(PAGE, 100)
    assert len(sent) == 3  # 4, 8 and 12 seconds in


def test_slow_redirect_hops_share_one_deadline(net, monkeypatch):
    clock = Clock(monkeypatch)
    timeouts = []

    def handler(request):
        timeouts.append(request.extensions["timeout"]["read"])
        clock.now += 6
        return httpx.Response(302, headers={"location": "/again"})

    net.handler = handler
    with pytest.raises(FetchError, match="too long"):
        fetch.fetch(PAGE, 100)
    assert timeouts == [10, 4]  # the third hop never starts


def test_slow_lookup_hits_the_deadline(net, monkeypatch):
    release = threading.Event()
    monkeypatch.setattr(fetch, "TIMEOUT", 0.2)
    monkeypatch.setattr(fetch.socket, "getaddrinfo", lambda *args, **kwargs: release.wait(5))
    started = time.monotonic()
    try:
        with pytest.raises(FetchError, match="too long"):
            fetch.fetch(PAGE, 100)
        assert time.monotonic() - started < 2
    finally:
        release.set()


def test_allowed_is_checked_on_every_hop(net):
    net.hosts["other.test"] = "93.184.216.36"

    def redirect(request):
        return httpx.Response(302, headers={"location": "https://other.test/x"})

    net.handler = redirect
    with pytest.raises(BadUrl, match="isn't allowed"):
        fetch.fetch("https://example.com/x", 100, allowed=lambda u: "example.com" in u)
    assert len(net.calls) == 1  # the second request is never made


def test_allowed_refuses_the_first_address_too(net):
    with pytest.raises(BadUrl):
        fetch.fetch("http://example.com/x", 100, allowed=lambda u: u.startswith("https:"))
    assert net.calls == []
