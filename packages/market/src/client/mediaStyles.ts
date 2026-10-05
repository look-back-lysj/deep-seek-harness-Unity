export const MEDIA_CSS = `
.eac-market__media-icon {
  width: var(--eac-media-icon-size, 44px);
  height: var(--eac-media-icon-size, 44px);
  position: relative;
  overflow: hidden;
  flex: 0 0 var(--eac-media-icon-size, 44px);
}

.eac-market__media-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.eac-market__media-icon img[hidden] {
  display: none;
}

.eac-market__media-preview {
  min-width: 0;
}

.eac-market__media-preview > button {
  width: 100%;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--eac-border, currentColor);
  border-radius: var(--eac-radius-md, 12px);
  background: var(--eac-panel-2, transparent);
  cursor: zoom-in;
}

.eac-market__media-preview > button:hover {
  border-color: var(--eac-border-strong, currentColor);
}

.eac-market__media-theme {
  display: block;
  margin-block: 0.35rem;
  font-size: 0.875rem;
  overflow-wrap: anywhere;
}

.eac-market__media-disclaimer {
  color: var(--eac-text-2, inherit);
  font-size: 0.875rem;
  overflow-wrap: anywhere;
}

@media (forced-colors: active) {
  .eac-market__media-icon {
    border: 1px solid CanvasText;
  }
}
`
