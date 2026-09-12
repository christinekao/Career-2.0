# Career Evidence Specification

## Purpose

This baseline records approved target behavior for the current M1 scope. It
does not claim that Career Evidence is implemented. Career Evidence is the
canonical, user-confirmed source of career facts that later materials may use.

## Requirements

### Requirement: Career Evidence is canonical truth

The system SHALL represent user-confirmed career facts as Career Evidence with
provenance, responsibility boundaries, outcomes, metric definitions, and
confirmation state.

#### Scenario: User confirms a career fact

- **WHEN** the user confirms an Evidence record
- **THEN** the record may be used as canonical career truth for later Opportunity work

#### Scenario: Generated content proposes a fact

- **WHEN** a generated CV, Story, import, or parser contains a new career claim
- **THEN** the claim remains a candidate until the user explicitly confirms a Career Evidence revision

### Requirement: Evidence revisions preserve historical facts

The system SHALL create a new immutable revision when a saved factual value,
source, responsibility boundary, metric definition, or confirmation state
changes, while retaining earlier revisions that are referenced by history.

#### Scenario: Current Evidence is edited

- **WHEN** the user changes a confirmed Evidence fact
- **THEN** a new revision becomes current and the previous revision remains readable and unchanged

### Requirement: Generated materials reference Evidence revisions

The system SHALL allow generated CV and Interview Story content to reference
the exact Evidence revisions used to create it without allowing that content to
write back into canonical Evidence automatically.

#### Scenario: CV and Story use the same fact

- **WHEN** a CV and Interview Story are prepared for an Opportunity
- **THEN** both can resolve their claims to the same fixed Evidence revision identities
