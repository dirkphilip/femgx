import { ChangeDetectionStrategy, Component, inject, viewChild } from "@angular/core";
import type { AfterViewInit, ElementRef, OnDestroy } from "@angular/core";
import { ViewerFacade } from "./viewer.facade";

/** Presents the one-scene Angular foundation without owning viewport state. */
@Component({
  selector: "femgx-viewer",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./viewer.component.html",
  styleUrl: "./viewer.component.css",
})
export class ViewerComponent implements AfterViewInit, OnDestroy {
  private readonly facade = inject(ViewerFacade);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>("canvas");
  readonly statusMessage = this.facade.statusMessage;
  readonly retryable = this.facade.retryable;

  /** Starts the coordinator after Angular has created the canvas. */
  ngAfterViewInit(): void {
    void this.facade.start(this.canvas().nativeElement);
  }

  /** Retries creation after an unsupported or failed attempt. */
  retry(): void {
    void this.facade.start(this.canvas().nativeElement);
  }

  /** Ends the viewport generation before the component leaves the DOM. */
  ngOnDestroy(): void {
    this.facade.destroy();
  }
}
