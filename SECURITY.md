# Security policy

**English** · [Português (BR)](SECURITY.pt-BR.md) · [Español](SECURITY.es.md)

## Covered versions

Prism is under development. While the version is `0.x`, the intent is that security fixes ship in the next version; no old
versions are maintained in parallel, and betas (the `X.Y.Z-beta.N` versions) are replaced by the next stable one. Before the first
published version (0.1.0), the `develop` branch is the one covered.

## How to report a vulnerability

**Do not open an issue, a comment or a pull request describing the flaw**: all of those are public.

Report it privately, through GitHub's **private vulnerability reporting**: on the repository page, open the **Security** tab and
click **Report a vulnerability**. The form asks for a summary, the details, a proof of concept and the impact. The report is
visible only to you and to the [maintainers](CONTRIBUTING.md#maintainers), and GitHub notifies the maintainers when it arrives
([documentation](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately)). GitHub itself
adds the reporter as a collaborator on the security advisory that comes out of the report, and that is where the conversation
continues.

The button only exists when the repository is **public** and private reporting is turned on in the settings. If it does not
appear, do not report through another public channel: open an issue **with no detail of the flaw**, only asking for a contact for
a security report, and a maintainer will answer.

## What to include

- The Prism version (it shows on the sign-in screen, next to the name; or the commit, if you built from source), the operating
  system and the database involved.
- What the flaw is and what it lets someone do: for example, read the contents of a vault without the password, use the local API
  without the token, run code from data coming from the database, or make the updater install a package that is not the one from
  the release.
- The steps to reproduce, as short as you can make them.
- What you expected and what happened.

Use test data. Never attach a real vault, a password, a token, a connection string or customer data. If the report needs a vault
file, create one with a test user.

## What to expect

- The intent is to answer in the report itself: acknowledge receipt, say whether the problem was reproduced and, if there is a
  fix, in which version it ships. There is no set deadline.
- We ask that the report not be disclosed before the fix is published.
- The reporter's name only goes into the notes of the version that carries the fix if the person wants it to.

## What is in scope

What Prism sets out to protect: each user's encrypted vault, the connection passwords, the local API (which only listens on
`127.0.0.1` and requires a launch token), the app window, what goes into the log and the update (the downloaded package is checked
against two SHA-256 checksums before any use; see the [documentation](https://zanveri.github.io/prism/#updates)).

Out of scope: anyone who already has access to the user's session on the operating system, with the app open and unlocked, and
flaws in the databases Prism connects to. An ordinary defect with no effect on security goes in a normal public issue.
