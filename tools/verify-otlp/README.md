# Independent OTLP wire verification

This verifier uses the official OpenTelemetry Collector pdata implementation, pinned to v1.66.0 in `go.mod` and `go.sum`. It decodes the reference export as OTLP JSON, checks the expected span count, and performs a protobuf encode/decode round trip. It makes no Collector or model-provider requests. Go may download the locked build dependencies.

From this directory, after generating the demo at the repository root:

```sh
go run . ../../.local/demo/evidence.otlp.json 784
```

Go 1.26 or newer is required; release verification uses Go 1.27.1. A JSON report and exit code zero indicate success. Invalid input, a wrong span count or a wire error exits nonzero.
