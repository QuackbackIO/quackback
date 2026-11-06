{{/*
Expand the name of the chart.
*/}}
{{- define "quackback.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "quackback.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "quackback.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/version: {{ .Values.app.image.tag | default .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{ include "quackback.selectorLabels" . }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "quackback.selectorLabels" -}}
app.kubernetes.io/name: {{ include "quackback.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Image tag, defaulting to the chart's appVersion (kept in sync with the
project's latest tested release — see Chart.yaml).
*/}}
{{- define "quackback.appImage" -}}
{{- printf "%s:%s" .Values.app.image.repository (.Values.app.image.tag | default .Chart.AppVersion) -}}
{{- end }}

{{/*
Redis/Dragonfly internal URL. Only meaningful when dragonfly.enabled — the
bundled Dragonfly runs with no auth, same as docker-compose.prod.yml.
*/}}
{{- define "quackback.redisUrl" -}}
redis://{{ include "quackback.fullname" . }}-dragonfly:6379
{{- end }}

{{/*
MinIO internal endpoint.
*/}}
{{- define "quackback.minioEndpoint" -}}
http://{{ include "quackback.fullname" . }}-minio:9000
{{- end }}

{{/*
Stable Postgres password: reused across `helm upgrade` by reading it back
from the already-deployed Secret (lookup), so the bundled StatefulSet's PVC
never ends up holding a password older than the current Secret. Falls back
to postgres.password, then to a random 24-char value on first install.
*/}}
{{- define "quackback.postgresPassword" -}}
{{- $secretName := printf "%s-postgres" (include "quackback.fullname" .) -}}
{{- $existing := lookup "v1" "Secret" .Release.Namespace $secretName -}}
{{- if $existing }}
{{- index $existing.data "POSTGRES_PASSWORD" | b64dec -}}
{{- else if .Values.postgres.password }}
{{- .Values.postgres.password -}}
{{- else -}}
{{- randAlphaNum 24 -}}
{{- end -}}
{{- end }}

{{/*
Stable MinIO root password — same reuse-on-upgrade rationale as
quackback.postgresPassword above.
*/}}
{{- define "quackback.minioPassword" -}}
{{- $secretName := printf "%s-minio" (include "quackback.fullname" .) -}}
{{- $existing := lookup "v1" "Secret" .Release.Namespace $secretName -}}
{{- if $existing }}
{{- index $existing.data "MINIO_ROOT_PASSWORD" | b64dec -}}
{{- else if .Values.minio.rootPassword }}
{{- .Values.minio.rootPassword -}}
{{- else -}}
{{- randAlphaNum 24 -}}
{{- end -}}
{{- end }}
