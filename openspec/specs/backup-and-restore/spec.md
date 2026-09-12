# Backup and Restore Specification

## Purpose

This baseline records approved target behavior for the current M1 scope. It
does not claim that backup or restore is implemented. Backup protects the
complete user-owned M1 state without making generated output canonical.

## Requirements

### Requirement: Backup is a deterministic integrity-checked bundle

The system SHALL create one logical backup bundle containing the M1 structured
state, required user-authored working bytes, attachments, source bytes needed
by references, submitted snapshots, and a manifest with contract/version,
logical identity, source class, media type, size, and SHA-256 for each entry.

#### Scenario: User backs up a complete M1 workspace

- **WHEN** the user requests a backup and every required entry is readable
- **THEN** the system produces a deterministic manifest and bundle whose entries and hashes can be independently validated

#### Scenario: A required source changes during capture

- **WHEN** a required entry cannot be read consistently or its identity changes during backup
- **THEN** the system fails the backup rather than publishing a partial or falsely complete bundle

### Requirement: Restore validates before materializing a new root

The system SHALL validate the manifest, all required bytes, hashes, references,
and supported contract/version information before reporting restore success, and
SHALL materialize the result into a new private root without silent overwrite or
merge.

#### Scenario: Backup is restored to a new location

- **WHEN** a valid bundle is restored to an empty or explicitly prepared new private root
- **THEN** the complete user-owned M1 state and historical references are available from that root

#### Scenario: Restore destination conflicts

- **WHEN** the destination is non-empty, identities collide, a byte is missing or corrupt, or the format is unsupported
- **THEN** restore fails before replacing or merging destination state

### Requirement: Generated artifacts are not required to be canonical

The system SHALL preserve canonical state, Evidence revisions, submitted
snapshots, and their references independently of optional generated outputs.

#### Scenario: Generated output is absent from a backup

- **WHEN** a backup omits a regenerable generated document but preserves its inputs and references
- **THEN** canonical state and historical submissions restore successfully, and the generated document may be rebuilt later as a candidate
