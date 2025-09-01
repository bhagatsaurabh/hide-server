package me.saurabhagat.hide.auth_service.controller;

import com.google.firebase.auth.FirebaseAuthException;
import jakarta.mail.MessagingException;
import me.saurabhagat.hide.auth_service.dto.RegisterEmailDTO;
import me.saurabhagat.hide.auth_service.dto.VerifyEmailDTO;
import me.saurabhagat.hide.auth_service.dto.VerifyEmailSuccessDTO;
import me.saurabhagat.hide.auth_service.exception.BadRequestException;
import me.saurabhagat.hide.auth_service.service.AuthService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
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
            throw new BadRequestException("INVALID_AUTH_HEADER");
        }

        var user = authService.validateToken(token);

        return ResponseEntity.ok(user);
    }

    @PostMapping("/register-email")
    public ResponseEntity<?> registerEmail(@RequestBody RegisterEmailDTO data) throws IOException, MessagingException {
        authService.registerEmail(data.getEmail());
        return ResponseEntity.ok(null);
    }

    @PostMapping("/verify-email")
    public ResponseEntity<?> verifyEmail(@RequestBody VerifyEmailDTO data) throws FirebaseAuthException {
        String token = authService.verifyEmail(data.getEmail(), data.getCode());
        return ResponseEntity.ok(new VerifyEmailSuccessDTO(token));
    }

    private String extractToken(String authHeader) {
        if (Objects.nonNull(authHeader) && authHeader.startsWith("Bearer ")) {
            return authHeader.substring(7);
        }
        return null;
    }
}
