"""Local recovery tool to decrypt Integration Registry ciphertext.

Usage:
  python integration_registry_decrypt.py \
    --tenant-id <uuid> \
    --passphrase "your key" \
    --salt-hex <hex> \
    --table ir_endpoint \
    --column fqdn \
    --ciphertext "enc:v1:..."
"""

from __future__ import annotations

import argparse
import base64
import sys
import uuid

from app.utils.crypto_at_rest import KdfParams, decrypt_str, derive_key


def _parse_salt(args: argparse.Namespace) -> bytes:
    if args.salt_hex:
        return bytes.fromhex(args.salt_hex)
    if args.salt_b64:
        return base64.b64decode(args.salt_b64)
    raise SystemExit("Provide --salt-hex or --salt-b64")


def main() -> int:
    parser = argparse.ArgumentParser(description="Decrypt Integration Registry ciphertext locally.")
    parser.add_argument("--tenant-id", required=True)
    parser.add_argument("--passphrase", required=True)
    parser.add_argument("--salt-hex", default=None)
    parser.add_argument("--salt-b64", default=None)
    parser.add_argument("--table", required=True, help="e.g. ir_endpoint, ir_instance, ir_route_hop")
    parser.add_argument("--column", required=True, help="e.g. fqdn, ip, vault_ref, proxy_chain")
    parser.add_argument("--ciphertext", required=True, help="Value stored in DB (enc:v1:...)")
    parser.add_argument("--kdf-n", type=int, default=2**14)
    parser.add_argument("--kdf-r", type=int, default=8)
    parser.add_argument("--kdf-p", type=int, default=1)
    parser.add_argument("--kdf-length", type=int, default=32)

    args = parser.parse_args()
    tenant_id = uuid.UUID(args.tenant_id)
    salt = _parse_salt(args)
    kdf_params = KdfParams(n=args.kdf_n, r=args.kdf_r, p=args.kdf_p, length=args.kdf_length)
    key = derive_key(args.passphrase, salt, kdf_params)

    aad = f"{tenant_id}:{args.table}:{args.column}".encode("utf-8")
    plaintext = decrypt_str(args.ciphertext, key, aad)
    print(plaintext)
    return 0


if __name__ == "__main__":
    sys.exit(main())
