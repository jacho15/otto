import json

import anthropic
import httpx2
import pytest

from conftest import ROOM
from otto_api import main
from otto_api.agent import first_sentences
from test_orders import write_order

MANDATE = {"max_item_price": None, "max_total": None, "shops": [], "expires": None}
URL = f"/api/rooms/{ROOM}/agent/checkout"
ORDERS = f"/api/rooms/{ROOM}/orders"


def text(t):
    return {"type": "text", "text": t}


def call(name, **args):
    return {"type": "tool_use", "id": f"toolu_{name}", "name": name, "input": args}


def sse(event, data):
    return f"event: {event}\ndata: {json.dumps({'type': event, **data})}\n\n"


def sse_message(content, stop):
    """A reply as server-sent events, the way the streaming API sends it."""
    message = {
        "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-opus-5-5",
        "content": [], "stop_reason": None, "stop_sequence": None,
        "usage": {"input_tokens": 1, "output_tokens": 1},
    }
    out = [sse("message_start", {"message": message})]
    for i, block in enumerate(content):
        if block["type"] == "text":
            start, delta = {**block, "text": ""}, {"type": "text_delta", "text": block["text"]}
        else:
            start = {**block, "input": {}}
            delta = {"type": "input_json_delta", "partial_json": json.dumps(block["input"])}
        out.append(sse("content_block_start", {"index": i, "content_block": start}))
        out.append(sse("content_block_delta", {"index": i, "delta": delta}))
        out.append(sse("content_block_stop", {"index": i}))
    out.append(sse("message_delta", {
        "delta": {"stop_reason": stop, "stop_sequence": None}, "usage": {"output_tokens": 1},
    }))
    out.append(sse("message_stop", {}))
    return "".join(out)


class FakeApi:
    """A scripted Anthropic API. Each model turn is a list of content blocks.

    before(n), if given, runs when request n arrives (0 is the first).
    """

    def __init__(self, turns, stop_reason=None, status=200, before=None):
        self.turns, self.stop_reason, self.status, self.before = turns, stop_reason, status, before
        self.requests = []

    def handler(self, request):
        self.requests.append(request)
        if self.status != 200:
            error = {"type": "error", "error": {"type": "api_error", "message": "scripted failure"}}
            return httpx2.Response(self.status, json=error)
        if self.before:
            self.before(len(self.requests) - 1)
        content = self.turns[min(len(self.requests), len(self.turns)) - 1]
        self.check_args(json.loads(request.content), content)
        stop = self.stop_reason or ("tool_use" if any(b["type"] == "tool_use" for b in content) else "end_turn")
        if json.loads(request.content).get("stream"):
            return httpx2.Response(
                200, headers={"content-type": "text/event-stream"}, content=sse_message(content, stop).encode(),
            )
        return httpx2.Response(200, json={
            "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-opus-5-5",
            "content": content, "stop_reason": stop, "stop_sequence": None,
            "usage": {"input_tokens": 1, "output_tokens": 1},
        })

    @staticmethod
    def check_args(body, content):
        """Scripted tool calls must use the argument names in that tool's schema, as the real API enforces.

        Catches a tool function whose parameter names drift from its input_schema.
        """
        schemas = {t["name"]: t.get("input_schema") for t in body.get("tools", []) if "name" in t}
        for block in content:
            schema = schemas.get(block.get("name")) if block.get("type") == "tool_use" else None
            if not schema or "properties" not in schema:
                continue
            unknown = set(block["input"]) - set(schema["properties"])
            assert not unknown, f"{block['name']} called with {sorted(unknown)}, not in its schema {sorted(schema['properties'])}"

    def client(self):
        return anthropic.Anthropic(
            api_key="test-key",
            max_retries=0,
            http_client=anthropic.DefaultHttpxClient(transport=httpx2.MockTransport(self.handler)),
        )

    def body(self, n):
        return json.loads(self.requests[n].content)

    def tool_results(self, n):
        return self.body(n)["messages"][-1]["content"]

    def result_text(self, n):
        content = self.tool_results(n)[0]["content"]
        return content if isinstance(content, str) else content[0]["text"]


@pytest.fixture
def agent(client, monkeypatch):
    """Run the checkout endpoint against a FakeApi."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    client.put("/api/mandate", json=MANDATE)

    def run(api, instruction="buy the sofa"):
        monkeypatch.setattr(main, "make_client", lambda key: api.client())
        return client.post(URL, json={"instruction": instruction})

    return run


def test_agent_proposes_an_order(agent, client):
    api = FakeApi([
        [call("get_room")],
        [call("propose_order", object_names=["sofa", "chair"],
              reasons=[{"object_name": "sofa", "reason": "seating"}, {"object_name": "chair", "reason": "extra"}])],
        [text("I proposed the sofa and chair. Please approve them.")],
    ])
    r = agent(api)
    assert r.status_code == 200
    body = r.json()
    assert body["message"] == "I proposed the sofa and chair. Please approve them."
    order = body["order"]
    assert order["status"] == "proposed" and order["created_by"] == "agent"
    assert order["agent_message"] == body["message"]
    assert [(i["object_name"], i["price"], i["reason"]) for i in order["items"]] == [
        ("sofa", 449.0, "seating"), ("chair", 50.5, "extra"),
    ]
    assert order["total"] == 499.5 and order["currency"] == "USD" and order["violations"] == []
    assert order["payment"] is None
    assert client.get(ORDERS).json() == [order]
    # The room data reached the model as a tool result.
    room = json.loads(api.result_text(1))
    assert {i["name"] for i in room["items"]} == {"sofa", "chair"}
    assert room["room_size"] == [5.0, 4.0]


def test_request_shape(agent):
    api = FakeApi([[text("Nothing to buy.")]])
    agent(api)
    request, body = api.requests[0], api.body(0)
    assert body["model"] == "claude-opus-5-5"
    assert body["max_tokens"] == 64000 and body["stream"] is True
    assert body["thinking"] == {"type": "adaptive"}
    assert body["output_config"] == {"effort": "medium"}
    assert body["fallbacks"] == "default"
    assert "server-side-fallback-2026-07-01" in request.headers["anthropic-beta"]
    for key in ("temperature", "tool_choice"):
        assert key not in body
    assert "budget_tokens" not in json.dumps(body)
    assert "x-api-key" in request.headers
    names = [t["name"] for t in body["tools"]]
    assert names == ["get_room", "get_catalog", "get_mandate", "check_order", "propose_order"]
    assert all(t["strict"] and t["input_schema"]["additionalProperties"] is False for t in body["tools"])


def test_unknown_and_hidden_names_are_rejected(agent, client, data_dir):
    path = data_dir / "rooms" / ROOM / "scene.json"
    scene = json.loads(path.read_text("utf-8"))
    scene["objects"][1]["hidden"] = True
    path.write_text(json.dumps(scene), "utf-8")
    api = FakeApi([
        [call("propose_order", object_names=["lamp"], reasons=[])],
        [call("propose_order", object_names=["chair"], reasons=[])],
        [call("propose_order", object_names=["shelf"], reasons=[])],
        [text("Those are not for sale.")],
    ])
    r = agent(api)
    assert r.status_code == 200
    assert r.json()["order"] is None
    for turn in (1, 2, 3):
        assert api.tool_results(turn)[0]["is_error"] is True
    assert "lamp" in api.result_text(1)
    assert client.get(ORDERS).json() == []


def test_second_proposal_cancels_the_first(agent, client):
    api = FakeApi([
        [call("propose_order", object_names=["sofa"], reasons=[])],
        [call("propose_order", object_names=["chair"], reasons=[])],
        [text("Changed my mind.")],
    ])
    order = agent(api).json()["order"]
    assert [i["object_name"] for i in order["items"]] == ["chair"]
    orders = client.get(ORDERS).json()
    assert sorted((o["status"], o["items"][0]["object_name"]) for o in orders) == [
        ("cancelled", "sofa"), ("proposed", "chair"),
    ]


def test_approval_during_the_run_is_kept(agent, client):
    def approve_before_last_turn(n):
        if n == 2:
            order = main.load_orders(ROOM)[0]
            assert main.approve_order(ROOM, order["id"])["status"] == "approved"

    api = FakeApi([
        [call("propose_order", object_names=["sofa"], reasons=[])],
        [call("get_mandate")],
        [text("Proposed the sofa.")],
    ], before=approve_before_last_turn)
    order = agent(api).json()["order"]
    assert order["status"] == "approved" and order["payment"] is not None
    assert order["agent_message"] == "Proposed the sofa."
    assert client.get(ORDERS).json() == [order]


def test_approval_during_a_re_proposal_is_kept(agent, client):
    def approve_before_second_proposal(n):
        if n == 1:
            order = main.load_orders(ROOM)[0]
            main.approve_order(ROOM, order["id"])

    api = FakeApi([
        [call("propose_order", object_names=["sofa"], reasons=[])],
        [call("propose_order", object_names=["chair"], reasons=[])],
        [text("Changed my mind.")],
    ], before=approve_before_second_proposal)
    agent(api)
    statuses = sorted((o["status"], o["items"][0]["object_name"]) for o in client.get(ORDERS).json())
    assert statuses == [("approved", "sofa"), ("proposed", "chair")]


def test_item_urls_must_be_http(agent, data_dir):
    path = data_dir / "rooms" / ROOM / "scene.json"
    scene = json.loads(path.read_text("utf-8"))
    scene["objects"][0]["product"]["url"] = "javascript:alert(1)"
    scene["objects"][1]["product"]["url"] = "https://example.com/chair"
    path.write_text(json.dumps(scene), "utf-8")
    api = FakeApi([
        [call("propose_order", object_names=["sofa", "chair"], reasons=[])],
        [text("Done.")],
    ])
    items = agent(api).json()["order"]["items"]
    assert [(i["object_name"], i["url"].startswith("https://")) for i in items] == [("sofa", False), ("chair", True)]
    assert items[0]["url"] == ""


def test_proposal_with_violations_is_saved_and_cannot_be_approved(agent, client):
    client.put("/api/mandate", json={**MANDATE, "max_item_price": 100})
    api = FakeApi([
        [call("check_order", object_names=["sofa"])],
        [call("propose_order", object_names=["sofa"], reasons=[])],
        [text("It is over the limit.")],
    ])
    order = agent(api).json()["order"]
    assert json.loads(api.result_text(1))["violations"]
    assert len(order["violations"]) == 1
    assert client.post(f"{ORDERS}/{order['id']}/approve").status_code == 409


def test_agent_cannot_buy_bought_items(agent, data_dir):
    write_order(data_dir, status="approved")
    api = FakeApi([
        [call("get_room")],
        [call("propose_order", object_names=["sofa"], reasons=[])],
        [text("Already bought.")],
    ])
    r = agent(api)
    room = json.loads(api.result_text(1))
    assert [i["name"] for i in room["items"]] == ["chair"]
    assert api.tool_results(2)[0]["is_error"] is True
    assert r.json()["order"] is None


def test_agent_has_no_way_to_pay_or_change_things(agent):
    api = FakeApi([[text("ok")]])
    agent(api)
    names = {t["name"] for t in api.body(0)["tools"]}
    assert names.isdisjoint({"approve_order", "cancel_order", "set_mandate", "move_object"})


def test_turn_cap(agent):
    api = FakeApi([[call("get_mandate")]])
    r = agent(api)
    assert r.status_code == 200
    assert len(api.requests) == 8
    assert "ran out of steps" in r.json()["message"]


def test_refusal_has_a_readable_message(agent):
    r = agent(FakeApi([[]], stop_reason="refusal"))
    assert r.status_code == 200
    assert "declined" in r.json()["message"]


@pytest.mark.parametrize("status, expected", [
    (401, "API key"),
    (429, "rate limit"),
    (500, "API error (500)"),
])
def test_api_errors_are_502(agent, status, expected):
    r = agent(FakeApi([[]], status=status))
    assert r.status_code == 502
    assert expected in r.json()["detail"]
    assert "test-key" not in r.text


def test_connection_error_is_502(client, monkeypatch):
    def refuse(request):
        raise httpx2.ConnectError("no route", request=request)

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    client.put("/api/mandate", json=MANDATE)
    bad = anthropic.Anthropic(
        api_key="test-key", max_retries=0,
        http_client=anthropic.DefaultHttpxClient(transport=httpx2.MockTransport(refuse)),
    )
    monkeypatch.setattr(main, "make_client", lambda key: bad)
    r = client.post(URL, json={"instruction": "buy"})
    assert r.status_code == 502 and "reach" in r.json()["detail"]


def test_no_api_key_is_503(client):
    client.put("/api/mandate", json=MANDATE)
    r = client.post(URL, json={"instruction": "buy the sofa"})
    assert r.status_code == 503
    assert r.json()["detail"] == "Add ANTHROPIC_API_KEY to .env"


def test_no_mandate_is_409(client, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    r = client.post(URL, json={"instruction": "buy the sofa"})
    assert r.status_code == 409
    assert r.json()["detail"] == "Set a spend mandate first"


@pytest.mark.parametrize("instruction", ["", "   ", "x" * 1001])
def test_instruction_length(client, instruction):
    assert client.post(URL, json={"instruction": instruction}).status_code == 422


def test_unknown_room(client):
    assert client.post("/api/rooms/nope/agent/checkout", json={"instruction": "x"}).status_code == 404


def test_first_sentences():
    assert first_sentences("A b. C d! E f? G h. I j.", 4) == "A b. C d! E f? G h."
    assert first_sentences("  Only one.  ", 4) == "Only one."
    assert first_sentences("About 2.5 m wide. Next.", 1) == "About 2.5 m wide."
    assert first_sentences("No end", 2) == "No end"
    assert first_sentences("", 4) == ""
