import { bootstrapAngularApp } from "../demo/angular/src/main.ts";

const root = document.querySelector("femgx-angular-app");
if (!(root instanceof HTMLElement)) throw new Error("The Angular app root is missing");

bootstrapAngularApp(root);
