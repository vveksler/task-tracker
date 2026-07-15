{{/*
Common labels applied to all resources.
*/}}
{{- define "task-tracker.labels" -}}
app.kubernetes.io/managed-by: Helm
app.kubernetes.io/part-of: task-tracker
{{- end }}

{{/*
Selector labels for a specific component.
Usage: include "task-tracker.selectorLabels" (dict "component" "backend")
*/}}
{{- define "task-tracker.selectorLabels" -}}
app.kubernetes.io/name: task-tracker
app.kubernetes.io/component: {{ .component }}
{{- end }}
