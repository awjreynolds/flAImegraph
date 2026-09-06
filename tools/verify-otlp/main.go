// Verifies a local OTLP JSON projection using the independently maintained
// OpenTelemetry Collector data implementation. It does not contact a Collector.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"

	"go.opentelemetry.io/collector/pdata/ptrace/ptraceotlp"
)

func verify() error {
	if len(os.Args) != 3 {
		return fmt.Errorf("usage: verify-otlp FILE EXPECTED_SPANS")
	}
	expected, err := strconv.Atoi(os.Args[2])
	if err != nil || expected < 0 {
		return fmt.Errorf("EXPECTED_SPANS must be a nonnegative integer")
	}
	input, err := os.ReadFile(os.Args[1])
	if err != nil {
		return err
	}
	request := ptraceotlp.NewExportRequest()
	if err := request.UnmarshalJSON(input); err != nil {
		return fmt.Errorf("Collector OTLP JSON decoder: %w", err)
	}
	count := request.Traces().SpanCount()
	if count != expected {
		return fmt.Errorf("decoded %d spans; expected %d", count, expected)
	}
	wire, err := request.MarshalProto()
	if err != nil {
		return err
	}
	decoded := ptraceotlp.NewExportRequest()
	if err := decoded.UnmarshalProto(wire); err != nil {
		return err
	}
	if decoded.Traces().SpanCount() != count {
		return fmt.Errorf("protobuf round trip changed span count")
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{
		"consumer": "go.opentelemetry.io/collector/pdata v1.66.0",
		"spans": count, "protobuf_bytes": len(wire), "valid": true,
	})
}

func main() {
	if err := verify(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
