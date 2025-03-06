package me.saurabhagat.hide.auth_service.controller;

import me.saurabhagat.hide.auth_service.service.AuthService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Objects;

@RestController
@RequestMapping("api")
public class AuthController {
    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/validate")
    public ResponseEntity<?> validateToken(@RequestHeader(HttpHeaders.AUTHORIZATION) String authHeader) {
        var token = extractToken(authHeader);
        if (Objects.isNull(token)) {
            return ResponseEntity.badRequest().body("Invalid authorization header");
        }

        var user = authService.validateToken(token);
        if (user == null) {
            return ResponseEntity.status(401).body("Invalid token");
        }

        return ResponseEntity.ok(user);
    }

    private String extractToken(String authHeader) {
        if (Objects.nonNull(authHeader) && authHeader.startsWith("Bearer ")) {
            return authHeader.substring(7);
        }
        return null;
    }
}
