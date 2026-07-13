#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRUST_STORE_DIR="${ROOT_DIR}/certs/trust-store"
CLIENT_DIR="${ROOT_DIR}/.mtls-client"

mkdir -p "${TRUST_STORE_DIR}" "${CLIENT_DIR}"

CA_KEY="${CLIENT_DIR}/ca.key"
CA_CERT="${TRUST_STORE_DIR}/ca-bundle.pem"
CA_CONFIG="${CLIENT_DIR}/ca.cnf"
CA_SERIAL="${CLIENT_DIR}/ca.srl"
CLIENT_KEY="${CLIENT_DIR}/client.key"
CLIENT_CSR="${CLIENT_DIR}/client.csr"
CLIENT_CERT="${CLIENT_DIR}/client.crt"
CLIENT_EXT="${CLIENT_DIR}/client.ext"
CLIENT_P12="${CLIENT_DIR}/client.p12"

if [[ -f "${CA_CERT}" && -f "${CLIENT_CERT}" && -f "${CLIENT_KEY}" ]] \
  && openssl x509 -in "${CA_CERT}" -noout -text | grep -q 'CA:TRUE' \
  && openssl x509 -in "${CLIENT_CERT}" -noout -text | grep -q 'TLS Web Client Authentication'; then
  rm -f "${TRUST_STORE_DIR}/ca-bundle.srl"
  echo "mTLS certificates already exist."
  echo "CA bundle: ${CA_CERT}"
  echo "Client certificate: ${CLIENT_CERT}"
  echo "Client key: ${CLIENT_KEY}"
  exit 0
fi

rm -f \
  "${CA_KEY}" \
  "${CA_CERT}" \
  "${TRUST_STORE_DIR}/ca-bundle.srl" \
  "${CA_SERIAL}" \
  "${CLIENT_KEY}" \
  "${CLIENT_CSR}" \
  "${CLIENT_CERT}" \
  "${CLIENT_EXT}" \
  "${CLIENT_P12}"

cat > "${CA_CONFIG}" <<'EOF'
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_ca
prompt = no

[req_distinguished_name]
C = JP
ST = Tokyo
L = Tokyo
O = learn-about-mtls
OU = demo
CN = learn-about-mtls-client-ca

[v3_ca]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
EOF

openssl genrsa -out "${CA_KEY}" 4096
openssl req -x509 -new -nodes \
  -key "${CA_KEY}" \
  -sha256 \
  -days 3650 \
  -out "${CA_CERT}" \
  -config "${CA_CONFIG}" \
  -extensions v3_ca

openssl genrsa -out "${CLIENT_KEY}" 2048
openssl req -new \
  -key "${CLIENT_KEY}" \
  -out "${CLIENT_CSR}" \
  -subj "/C=JP/ST=Tokyo/L=Tokyo/O=learn-about-mtls/OU=demo/CN=learn-about-mtls-client"

cat > "${CLIENT_EXT}" <<'EOF'
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
EOF

openssl x509 -req \
  -in "${CLIENT_CSR}" \
  -CA "${CA_CERT}" \
  -CAkey "${CA_KEY}" \
  -CAserial "${CA_SERIAL}" \
  -CAcreateserial \
  -out "${CLIENT_CERT}" \
  -days 825 \
  -sha256 \
  -extfile "${CLIENT_EXT}"

openssl pkcs12 -export \
  -out "${CLIENT_P12}" \
  -inkey "${CLIENT_KEY}" \
  -in "${CLIENT_CERT}" \
  -certfile "${CA_CERT}" \
  -passout pass:

echo "Created mTLS certificates."
echo "CA bundle: ${CA_CERT}"
echo "Client certificate: ${CLIENT_CERT}"
echo "Client key: ${CLIENT_KEY}"
echo "Client PKCS#12: ${CLIENT_P12}"
