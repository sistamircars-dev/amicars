from __future__ import annotations

from flask import Flask, abort, jsonify, request

from app.brand import apply_brand_assets
from app.config import Config
from app.extensions import csrf, limiter, talisman
from app.security import apply_security_headers, is_blocked_path, register_csp


def create_app(config_class: type[Config] = Config) -> Flask:
    app = Flask(
        __name__,
        static_folder="static",
        template_folder="templates",
        static_url_path="/static",
    )
    app.config.from_object(config_class)
    apply_brand_assets(app)
    app.json.sort_keys = False
    app.debug = False
    app.testing = False
    app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 31536000

    limiter.init_app(app)
    csrf.init_app(app)
    talisman.init_app(
        app,
        force_https=app.config["FORCE_HTTPS"],
        strict_transport_security=app.config["FORCE_HTTPS"],
        strict_transport_security_max_age=31536000,
        strict_transport_security_include_subdomains=True,
        strict_transport_security_preload=True,
        frame_options="DENY",
        referrer_policy="strict-origin-when-cross-origin",
        session_cookie_secure=app.config["COOKIE_SECURE"],
        session_cookie_http_only=True,
        content_security_policy=register_csp(app),
        content_security_policy_nonce_in=["script-src"],
        force_file_save=False,
        x_content_type_options=True,
        x_xss_protection=True,
    )

    @app.before_request
    def _block_sensitive_and_source() -> None:
        if is_blocked_path(request.path):
            abort(403)

    @app.after_request
    def _harden_response(response):
        return apply_security_headers(app, response)

    from app.blueprints.auth import bp as auth_bp
    from app.blueprints.bcv import bp as bcv_bp
    from app.blueprints.health import bp as health_bp
    from app.blueprints.media import bp as media_bp
    from app.blueprints.panel import bp as panel_bp
    from app.blueprints.pwa import bp as pwa_bp
    from app.blueprints.sync import bp as sync_bp

    app.register_blueprint(pwa_bp)
    app.register_blueprint(health_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(panel_bp)
    app.register_blueprint(sync_bp)
    app.register_blueprint(media_bp)
    app.register_blueprint(bcv_bp)

    @app.errorhandler(403)
    def forbidden(_err):
        return jsonify({"ok": False, "error": "Acceso denegado"}), 403

    @app.errorhandler(404)
    def not_found(_err):
        return jsonify({"ok": False, "error": "Recurso no encontrado"}), 404

    @app.errorhandler(413)
    def too_large(_err):
        return jsonify({"ok": False, "error": "Archivo demasiado grande"}), 413

    @app.errorhandler(429)
    def ratelimited(_err):
        return jsonify({"ok": False, "error": "Demasiados intentos. Espere un minuto."}), 429

    @app.errorhandler(500)
    def server_error(_err):
        return jsonify({"ok": False, "error": "Error interno"}), 500

    return app
