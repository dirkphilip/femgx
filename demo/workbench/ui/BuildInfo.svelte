<script lang="ts">
  import { currentBuildInfoPresentation } from "../build-info";

  const build = currentBuildInfoPresentation();
</script>

<div id="build-info" class="build-info" data-testid="build-info">
  {build.timestamp} ·
  {#if build.shortRevision !== undefined && build.commitUrl !== undefined}
    <a href={build.commitUrl} aria-label={`Source commit ${build.shortRevision}`}
      >{build.shortRevision}</a
    >
  {:else}
    local build
  {/if}
</div>
