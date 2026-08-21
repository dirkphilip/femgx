<script lang="ts">
  import type { WorkbenchPresentationPort, WorkbenchSnapshot } from "../presentation/snapshot";
  import AnalysisFieldsControls from "./AnalysisFieldsControls.svelte";
  import AnalysisOrientationControls from "./AnalysisOrientationControls.svelte";
  import AnalysisPlaybackControls from "./AnalysisPlaybackControls.svelte";
  import AnalysisSectionControls from "./AnalysisSectionControls.svelte";

  let {
    workbench,
    snapshot,
  }: {
    workbench: WorkbenchPresentationPort | undefined;
    snapshot: WorkbenchSnapshot | undefined;
  } = $props();

  const hasResultFields = $derived(
    (snapshot?.analysis.scalarFields.length ?? 0) > 0 ||
      (snapshot?.analysis.deformationFields.length ?? 0) > 0 ||
      (snapshot?.analysis.vectorFields.length ?? 0) > 0,
  );
</script>

<div
  id="analysis-surface"
  data-testid="analysis-surface"
  class="analysis-inspector"
  role="group"
  aria-label="Analysis inspector"
>
  <AnalysisPlaybackControls {workbench} playback={snapshot?.analysis.playback} />
  <AnalysisFieldsControls {workbench} {snapshot} />
  <AnalysisOrientationControls {workbench} {snapshot} />
  <AnalysisSectionControls {workbench} {snapshot} {hasResultFields} />
</div>
