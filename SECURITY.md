# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| `main` branch | ✅ |
| Older tags | ❌ |

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Report vulnerabilities by emailing the maintainer through their GitHub profile, or by using [GitHub's private security advisory feature](https://github.com/jaredzwick/polymarket-trading-bot/security/advisories/new).

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

You will receive an acknowledgement within 48 hours and a resolution timeline within 7 days.

## Security Considerations for Users

This bot handles private keys and API credentials. Follow these practices:

- **Never commit `.env`** — it's in `.gitignore`, keep it that way
- **Use a dedicated wallet** with only the funds you intend to trade
- **Always test with `DRY_RUN=true`** before live trading
- **Review `MAX_DAILY_LOSS`** — this is your hard stop; set it conservatively
- **Rotate API keys** if you suspect compromise
- **Do not run on a shared machine** where other users can read process environment variables
