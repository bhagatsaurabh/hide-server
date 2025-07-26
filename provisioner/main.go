package main

import (
	"fmt"
	"hideserver/provisioner/server"
	"log"
	"net/http"
	"os"

	"github.com/nats-io/nats.go"
	"github.com/redis/go-redis/v9"
)

func main() {
	redisHost := os.Getenv("REDIS_HOST")
	redisPort := os.Getenv("REDIS_PORT")
	redisClient := redis.NewClient(&redis.Options{
		Addr: fmt.Sprintf("%s:%s", redisHost, redisPort),
	})

	natsURI := os.Getenv("NATS_URL")
	natsClient, err := nats.Connect(natsURI)
	if err != nil {
		log.Fatalf("Error connecting to NATS: %v", err)
	}
	defer natsClient.Drain()

	srv := server.NewServer(redisClient, natsClient)
	port := os.Getenv("SERVICE_PORT")
	if port == "" {
		port = "80"
	}
	log.Println("Server is running on port", port)
	log.Fatal(http.ListenAndServe(fmt.Sprintf(":%s", port), srv.Router))
}
