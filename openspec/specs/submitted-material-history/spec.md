# Submitted Material History Specification

## Purpose

This baseline records approved target behavior for the current M1 scope. It
does not claim that submission history is implemented. A submission is an
immutable historical account of what was sent for an Opportunity.

## Requirements

### Requirement: Submission captures a self-contained historical snapshot

The system SHALL capture, at explicit user confirmation, the submitted
material bytes or content, submission time, Opportunity identity, source or
channel, attachment identities and captured bytes when available, exact Career
Evidence revision references and content needed to explain those references,
and the applicable positioning/material revision references.

#### Scenario: User records a submission

- **WHEN** the user confirms that a material was submitted for an Opportunity
- **THEN** the system stores the required snapshot metadata, content identity, hashes, and exact Evidence revision references together

#### Scenario: Historical evidence references are unavailable

- **WHEN** an older material has no recoverable Evidence reference from the time it was sent
- **THEN** the system records that reference as missing or unknown and does not fill it from the current Evidence pointer

### Requirement: Submitted history is immutable

The system SHALL reject ordinary edits to the bytes and captured historical
fields of a submitted snapshot. A correction or later submission SHALL create a
separate record without rewriting the original snapshot.

#### Scenario: Working material changes after submission

- **WHEN** the user edits the working material or Evidence after submitting it
- **THEN** the submitted content, metadata, and Evidence references remain unchanged

#### Scenario: Snapshot bytes do not match their recorded identity

- **WHEN** a submitted artifact fails its recorded identity or hash check
- **THEN** the system reports the snapshot as invalid or unavailable and does not silently replace its bytes

### Requirement: Submission recording is recoverable and idempotent

The system SHALL distinguish an explicit submission from an export, avoid
duplicate history for a repeated operation, and never report a complete
submission when the snapshot write was interrupted.

#### Scenario: User repeats the same submission action

- **WHEN** the same user operation is retried after completion
- **THEN** the system keeps one historical submission rather than creating a duplicate

#### Scenario: Snapshot creation is interrupted

- **WHEN** required snapshot data cannot be fully written or validated
- **THEN** the system reports failure or an incomplete state and does not report a complete submission
