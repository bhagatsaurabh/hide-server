package util

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"

	"golang.org/x/crypto/ssh"
)

func GenSSHKeyPair(bits int) (string, string, error) {
	privateKey, err := rsa.GenerateKey(rand.Reader, bits)
	if err != nil {
		return "", "", err
	}

	privateKeyDER := x509.MarshalPKCS1PrivateKey(privateKey)
	privateKeyPEMBlock := &pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: privateKeyDER,
	}
	privateKeyPEM := string(pem.EncodeToMemory(privateKeyPEMBlock))

	publicKey, err := ssh.NewPublicKey(&privateKey.PublicKey)
	if err != nil {
		return "", "", err
	}
	publicKeyOpenSSH := string(ssh.MarshalAuthorizedKey(publicKey))

	return privateKeyPEM, publicKeyOpenSSH, nil
}
