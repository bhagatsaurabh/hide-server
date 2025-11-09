package util

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"

	"golang.org/x/crypto/ssh"
)

/* // Deprecated: Slow
func GenSSHKeyPair_Slow(bits int) (string, string, error) {
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
} */

func GenSSHKeyPair() (string, string, error) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return "", "", err
	}

	privBytes, err := ssh.MarshalPrivateKey(privateKey, "devuser")
	if err != nil {
		return "", "", err
	}
	privateKeyPEM := string(pem.EncodeToMemory(privBytes))

	pubKey, err := ssh.NewPublicKey(publicKey)
	if err != nil {
		return "", "", err
	}
	publicAuthorizedKey := string(ssh.MarshalAuthorizedKey(pubKey))

	return privateKeyPEM, publicAuthorizedKey, nil
}
