{{- define "babyfolio-storage-optimization.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "babyfolio-storage-optimization.fullname" -}}
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

{{- define "babyfolio-storage-optimization.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "babyfolio-storage-optimization.labels" -}}
helm.sh/chart: {{ include "babyfolio-storage-optimization.chart" . }}
app.kubernetes.io/name: {{ include "babyfolio-storage-optimization.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "babyfolio-storage-optimization.selectorLabels" -}}
app.kubernetes.io/name: {{ include "babyfolio-storage-optimization.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "babyfolio-storage-optimization.componentLabels" -}}
{{ include "babyfolio-storage-optimization.labels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "babyfolio-storage-optimization.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "babyfolio-storage-optimization.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}
