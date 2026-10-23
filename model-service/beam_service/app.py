"""CPU 推理服务。由网站后端访问，默认仅监听回环地址。"""
from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .registry import DEFAULT_MODELS, Registry
from .schemas import DesignRequest, ReviewRequest
from .service import BeamService

logger = logging.getLogger(__name__)


def create_app(models_dir=DEFAULT_MODELS):
    @asynccontextmanager
    async def lifespan(app):
        # 单个 worker 生命周期只加载一次；校验失败会令服务启动失败。
        app.state.registry = Registry(models_dir)
        app.state.service = BeamService(app.state.registry)
        yield
        del app.state.service
        del app.state.registry

    app = FastAPI(title="梁配筋教学模型服务", version="1.0.0", lifespan=lifespan)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        translations = {
            "missing": "缺少必填字段", "extra_forbidden": "不允许额外字段",
            "literal_error": "取值不在当前支持范围内", "json_invalid": "请求必须为有效 JSON",
            "model_attributes_type": "请求正文必须为 JSON 对象",
        }
        errors = []
        for error in exc.errors():
            kind = error["type"]
            message = translations.get(kind, error["msg"])
            if message.startswith("Value error, "):
                message = message[len("Value error, "):]
            errors.append({"loc": list(error["loc"]), "type": kind, "msg": message})
        return JSONResponse(status_code=422, content={"detail": errors})

    def execute(request, method, data):
        try:
            return getattr(request.app.state.service, method)(data)
        except (ValueError, ArithmeticError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None
        except RuntimeError:
            logger.exception("模型输出未通过完整性检查")
            raise HTTPException(status_code=503, detail="模型输出异常，请联系维护人员检查模型版本") from None

    @app.get("/health")
    def health(request: Request):
        registry = request.app.state.registry
        return {"status": "ok", "models_loaded": len(registry.bundles),
                "release": registry.manifest["release"], "model_versions": registry.versions()}

    @app.get("/v1/manifest")
    def manifest(request: Request):
        return request.app.state.registry.public_manifest()

    @app.post("/v1/design")
    def design(data: DesignRequest, request: Request):
        return execute(request, "design", data)

    @app.post("/v1/review")
    def review(data: ReviewRequest, request: Request):
        return execute(request, "review", data)

    return app


app = create_app()
