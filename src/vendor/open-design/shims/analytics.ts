// Hand-written adapter (not vendored). The standalone preview sends no
// analytics; the event prop types are kept so vendored signatures type-check.
// From packages/contracts/src/analytics/events/ui-click.ts.
export interface TabLauncherClickProps {
  page_name: 'file_manager';
  area: 'tab_launcher';
  element: 'open' | 'filter' | 'create' | 'open_file' | 'open_tab';
  action_id?: string;
  kind_filter?: string;
  file_kind?: string;
  tab_kind?: string;
  project_id?: string;
}
