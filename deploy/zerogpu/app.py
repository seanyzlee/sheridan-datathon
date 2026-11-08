"""Toonie on a free Hugging Face Space (Gradio SDK on ZeroGPU).

Free accounts can't run Docker or cpu-basic Spaces, only Gradio on ZeroGPU. ZeroGPU refuses to start
without one @spaces.GPU function, so there is a no-op one that nothing calls: no GPU quota is used.
The app itself is the unchanged FastAPI app in api.py (API plus the prebuilt React front end in
web/dist), served by Gradio's server. Everything runs on CPU from the Parquet cache.
"""

import spaces  # must be imported before anything that touches CUDA (nothing here does)

from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.routing import APIRoute
from gradio import Server
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.staticfiles import StaticFiles

import api


@spaces.GPU(duration=1)
def _noop() -> None:
    """ZeroGPU needs at least one decorated function; this one is never called."""


demo = Server(title="Toonie", docs_url=None, redoc_url=None, openapi_url=None, lifespan=api.lifespan)
demo.add_middleware(GZipMiddleware, minimum_size=1024)
for exc, handler in api.app.exception_handlers.items():
    demo.add_exception_handler(exc, handler)

# Toonie's API routes, then the built front end's assets. Gradio adds its own routes at launch.
for r in api.app.router.routes:
    if isinstance(r, APIRoute) and r.path.startswith("/api/"):
        demo.router.routes.append(r)
demo.mount("/assets", StaticFiles(directory=api.DIST / "assets"), name="assets")


@demo.get("/", include_in_schema=False)
async def _home():
    """The React app's entry page (with GRADIO_SSR_MODE=false, this route wins over Gradio's own page)."""
    return FileResponse(api.DIST / "index.html")


@demo.exception_handler(404)
async def _front_end(request: Request, exc: HTTPException):
    """Any other page is the React app (it does its own routing); unknown API paths stay a JSON 404."""
    path = request.url.path.lstrip("/")
    if request.method != "GET" or path.startswith(("api/", "gradio_api/")):
        return JSONResponse({"detail": getattr(exc, "detail", "Not Found")}, status_code=404)
    f = (api.DIST / path).resolve()
    if path and f.is_file() and api.DIST in f.parents:
        return FileResponse(f)
    return FileResponse(api.DIST / "index.html")


if __name__ == "__main__":
    demo.launch(ssr_mode=False)
