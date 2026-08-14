<div
  id="result-controls"
  data-testid="result-controls"
  class="result-controls"
  role="group"
  aria-label="Result display"
  hidden
>
  <label for="result-field">
    <span>Scalar</span>
    <select id="result-field" data-testid="result-field" aria-label="Scalar field">
      <option value="__base__">Base</option>
    </select>
  </label>
  <label for="deformation-field">
    <span>Deformation</span>
    <select id="deformation-field" data-testid="deformation-field" aria-label="Deformation field">
      <option value="__off__">Off</option>
    </select>
  </label>
  <label for="deformation-scale">
    <span>Scale</span>
    <input
      id="deformation-scale"
      data-testid="deformation-scale"
      type="number"
      min="0"
      step="any"
      inputmode="decimal"
      value="1"
      aria-label="Deformation scale"
    />
  </label>
  <label for="vector-field">
    <span>Vector</span>
    <select id="vector-field" data-testid="vector-field" aria-label="Elemental vector field">
      <option value="__vectors_off__">Off</option>
    </select>
  </label>
  <label for="vector-glyph">
    <span>Glyph</span>
    <select id="vector-glyph" data-testid="vector-glyph" aria-label="Vector glyph">
      <option value="arrow">Arrow</option>
      <option value="axis">Axis</option>
    </select>
  </label>
  <label for="vector-transform">
    <span>Transform</span>
    <select id="vector-transform" data-testid="vector-transform" aria-label="Vector transform">
      <option value="direction">Direction</option>
      <option value="normal">Normal</option>
    </select>
  </label>
  <label for="vector-length-scale">
    <span>Vector scale</span>
    <input
      id="vector-length-scale"
      data-testid="vector-length-scale"
      type="number"
      min="0.01"
      step="any"
      inputmode="decimal"
      value="1"
      aria-label="Vector length scale"
    />
  </label>
  <span id="vector-help" data-testid="vector-help" class="result-orientation-help">
    Normalized orientation; magnitude not displayed
  </span>
</div>
<div
  id="section-controls"
  data-testid="section-controls"
  class="section-controls"
  role="group"
  aria-label="Section plane"
>
  <label for="section-axis">
    <span>Section</span>
    <select id="section-axis" data-testid="section-axis" aria-label="Section axis">
      <option value="off">Off</option>
      <option value="x">Keep +X</option>
      <option value="y">Keep +Y</option>
      <option value="z">Keep +Z</option>
    </select>
  </label>
  <label for="section-offset">
    <span>Offset</span>
    <input
      id="section-offset"
      data-testid="section-offset"
      type="range"
      min="0"
      max="1"
      step="any"
      value="0"
      aria-label="Section offset"
    />
    <output id="section-offset-value" data-testid="section-offset-value">0</output>
  </label>
</div>
