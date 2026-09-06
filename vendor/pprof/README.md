# Vendored pprof schema

The file profile.proto is the official Google pprof schema copied from
https://github.com/google/pprof/blob/d6c3cb2f37ec22719bbaf5eb031d9a46635cb5b2/proto/profile.proto
at commit d6c3cb2f37ec22719bbaf5eb031d9a46635cb5b2. The Apache 2.0
copyright and license header are retained in the source file.

The profile exporter parses this schema with protobufjs and gzip-compresses
the encoded message as required by the schema comments. No wire fields or
message definitions are added here. The complete Apache License 2.0 text for
this vendored schema is in [LICENSE](LICENSE).
