Public test-only self-signed certificate and private key for the CI HTTPS proxy.
Never deploy these files or use this key outside automated localhost/LAN tests.
Browsers explicitly ignore this fixture certificate's trust/name errors; application
cookies still use the real production HttpOnly, SameSite and Secure attributes.
