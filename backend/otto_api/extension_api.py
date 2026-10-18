"""Routes for the browser extension."""
from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, StringConstraints, field_validator

from .custom import web_url
from .importer import parse_product

router = APIRouter()

MAX_HTML = 3_000_000


class PageBody(BaseModel):
    url: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    html: Annotated[str, StringConstraints(max_length=MAX_HTML)]

    @field_validator("url")
    @classmethod
    def http_only(cls, value):
        return web_url(value)


@router.post("/api/import/page")
def import_page(body: PageBody):
    """A draft item from page HTML that the extension sends. Nothing is fetched or saved."""
    try:
        return parse_product(body.html, body.url)
    except ValueError:
        raise HTTPException(422, "Couldn't find a product on that page. Enter it by hand.")
