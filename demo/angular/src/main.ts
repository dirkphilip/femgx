import "@angular/compiler";
import { bootstrapApplication } from "@angular/platform-browser";
import { AppComponent } from "./app/app.component";

/** Bootstraps the Angular composition root into the supplied host element. */
export function bootstrapAngularApp(root: HTMLElement): void {
  void bootstrapApplication(AppComponent).catch((error: unknown) => {
    root.textContent = error instanceof Error ? error.message : "Angular bootstrap failed";
  });
}
