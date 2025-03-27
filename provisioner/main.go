package main

import (
	"fmt"
	"hideserver/provisioner/server"
	"log"
	"net/http"
	"os"
)

func main() {
	srv := server.NewServer()

	port := os.Getenv("SERVICE_PORT")
	if port == "" {
		port = "3005"
	}
	log.Println("Server is running on port", port)
	log.Fatal(http.ListenAndServe(fmt.Sprintf(":%s", port), srv.Router))
}
