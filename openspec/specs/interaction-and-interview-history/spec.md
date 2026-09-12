# Interaction and Interview History Specification

## Purpose

This baseline records approved target behavior for the current M1 scope. It
does not claim that interaction or interview history is implemented. The
capability keeps lightweight attributed history attached to an Opportunity.

## Requirements

### Requirement: Interactions remain lightweight and attributed

The system SHALL record an interaction's who, when, channel, summary,
recruiter feedback, important facts, concern, next step, and follow-up, while
preserving whether information is user observation, another person's statement,
or unknown.

#### Scenario: User records a recruiter interaction

- **WHEN** the user saves a conversation note for an Opportunity
- **THEN** the nine lightweight fields can be retrieved with the associated person and source attribution

#### Scenario: No outcome explanation is known

- **WHEN** the user records a rejection or stalled interaction without explicit feedback
- **THEN** the system preserves the outcome and represents the reason as unknown rather than inferring one

### Requirement: Interview history binds to an explicit submitted material

The system SHALL store interview events under their Opportunity and SHALL allow
each interview to identify the submitted material the other party actually saw.

#### Scenario: Interview uses a known submission

- **WHEN** the user identifies the submitted CV or material for an interview
- **THEN** the interview record opens that exact submitted snapshot and its historical references

#### Scenario: Multiple submissions are not disambiguated

- **WHEN** more than one submitted material could match an interview and the user has not selected one
- **THEN** the system marks the link as needing confirmation and does not select the latest working material automatically

### Requirement: Interaction history does not become a CRM

The system SHALL support contacts across Opportunities and explicit application,
interview, result, and next-action history without introducing lead scoring,
contact pipelines, outreach campaigns, automation, or organization CRM behavior.

#### Scenario: One contact appears in multiple Opportunities

- **WHEN** the user records the same recruiter for more than one Opportunity
- **THEN** the contact may be associated with both Opportunities while each interaction remains in its own Opportunity context
