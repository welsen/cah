import App from "./app.mjs";
import routes from "./routes.config.json" with { type: "json" };

App.getInstance(routes);
