package me.saurabhagat.hide.auth_service.service;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseAuthException;
import com.google.firebase.auth.FirebaseToken;
import lombok.extern.slf4j.Slf4j;
import me.saurabhagat.hide.auth_service.dto.User;
import org.springframework.stereotype.Service;

@Slf4j
@Service
public class AuthService {
    public User validateToken(String token) {
        try {
            var firebaseAuth = FirebaseAuth.getInstance();
            FirebaseToken decodedToken = firebaseAuth.verifyIdToken(token);
            // TODO: Get name & username from firestore
            return new User(
                    decodedToken.getUid(),
                    decodedToken.getName(),
                    decodedToken.getEmail(),
                    decodedToken.getPicture(),
                    decodedToken.getIssuer()
            );
        } catch (FirebaseAuthException e) {
            log.error("", e);
            return null;
        }
    }
}
