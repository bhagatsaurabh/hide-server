package me.saurabhagat.hide.auth_service.service;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseAuthException;
import com.google.firebase.auth.FirebaseToken;
import lombok.extern.slf4j.Slf4j;
import me.saurabhagat.hide.auth_service.dto.User;
import me.saurabhagat.hide.auth_service.exception.BadRequestException;
import me.saurabhagat.hide.auth_service.exception.UnauthorizedException;
import me.saurabhagat.hide.auth_service.utils.Constants;
import me.saurabhagat.hide.auth_service.utils.Utils;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Slf4j
@Service
public class AuthService {
    EmailService emailService;

    public AuthService(EmailService emailService) {
        this.emailService = emailService;
    }

    public User validateToken(String token) {
        try {
            var firebaseAuth = FirebaseAuth.getInstance();
            FirebaseToken decodedToken = firebaseAuth.verifyIdToken(token);
            return new User(
                    decodedToken.getUid(),
                    decodedToken.getName(),
                    decodedToken.getEmail(),
                    decodedToken.getPicture(),
                    decodedToken.getIssuer()
            );
        } catch (FirebaseAuthException e) {
            throw new UnauthorizedException("INVALID_TOKEN");
        }
    }

    public void registerEmail(String email) throws IOException {
        if (!this.validateEmail(email)) {
            throw new BadRequestException("INVALID EMAIL");
        }
        var pin = Utils.generatePin(5);
        this.emailService.sendPinEmail(email, pin);
    }

    private boolean validateEmail(String email) {
        final Pattern pattern = Pattern.compile(Constants.EMAIL_REGEX);
        final Matcher matcher = pattern.matcher(email);
        return matcher.matches();
    }
}
