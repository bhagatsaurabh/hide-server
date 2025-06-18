package handlers

type UserHeader struct {
	Uid      string `json:"uid"`
	Name     string `json:"name"`
	Username string `json:"username"`
	Email    string `json:"email"`
	Picture  string `json:"picture"`
	Issuer   string `json:"issuer"`
}
