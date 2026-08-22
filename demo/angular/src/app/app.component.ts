import { ChangeDetectionStrategy, Component } from "@angular/core";
import { ViewportCoordinator } from "../effects/viewport/viewport-coordinator";
import { ViewerComponent } from "../features/viewer/viewer.component";
import { ViewerFacade } from "../features/viewer/viewer.facade";
import { AngularApplicationState } from "../state/application-state";

/** Angular composition root for the first one-viewport foundation slice. */
@Component({
  selector: "femgx-angular-app",
  standalone: true,
  imports: [ViewerComponent],
  providers: [AngularApplicationState, ViewportCoordinator, ViewerFacade],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: "<femgx-viewer />",
})
export class AppComponent {}
