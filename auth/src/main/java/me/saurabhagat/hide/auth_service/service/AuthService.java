package me.saurabhagat.hide.auth_service.service;

import com.google.firebase.auth.*;
import jakarta.mail.MessagingException;
import lombok.extern.slf4j.Slf4j;
import me.saurabhagat.hide.auth_service.dto.User;
import me.saurabhagat.hide.auth_service.exception.BadRequestException;
import me.saurabhagat.hide.auth_service.exception.InternalServerErrorException;
import me.saurabhagat.hide.auth_service.exception.TooManyRequestsException;
import me.saurabhagat.hide.auth_service.exception.UnauthorizedException;
import me.saurabhagat.hide.auth_service.models.CacheEmailSignIn;
import me.saurabhagat.hide.auth_service.utils.CacheKey;
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
    RedisService redisService;
    private final int MAX_ATTEMPT_COUNT = 3;

    public AuthService(EmailService emailService, RedisService redisService) {
        this.emailService = emailService;
        this.redisService = redisService;
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

    public void registerEmail(String email) throws IOException, MessagingException {
        if (!this.validateEmail(email)) {
            throw new BadRequestException("INVALID_EMAIL");
        }
        var pin = Utils.generatePin(5);

        CacheEmailSignIn cachedPin;
        if (this.redisService.exists(CacheKey.EMAIL_VERIFICATION_PIN(email))) {
            cachedPin = this.redisService.get(CacheKey.EMAIL_VERIFICATION_PIN(email), CacheEmailSignIn.class);
        } else {
            cachedPin = new CacheEmailSignIn(0, 0, pin);
        }
        cachedPin.setReqAttemptCount(cachedPin.getReqAttemptCount() + 1);
        cachedPin.setPin(pin);

        if (cachedPin.getVerifyAttemptCount() > MAX_ATTEMPT_COUNT) {
            this.redisService.set(CacheKey.EMAIL_VERIFICATION_PIN(email), cachedPin, 900);
            throw new TooManyRequestsException("EMAIL_VERIFY_CODE_MAX_ATTEMPTS_REACHED");
        }
        if (cachedPin.getReqAttemptCount() > MAX_ATTEMPT_COUNT) {
            this.redisService.set(CacheKey.EMAIL_VERIFICATION_PIN(email), cachedPin, 900);
            throw new TooManyRequestsException("EMAIL_REQUEST_CODE_MAX_ATTEMPTS_REACHED");
        }
        this.redisService.set(CacheKey.EMAIL_VERIFICATION_PIN(email), cachedPin, 300);

        this.emailService.sendPinEmail(email, pin);
    }

    public String verifyEmail(String email, String pin) throws FirebaseAuthException {
        CacheEmailSignIn cachedPin;
        if (!this.redisService.exists(CacheKey.EMAIL_VERIFICATION_PIN(email))) {
            throw new BadRequestException("PIN_EXPIRED");
        }
        cachedPin = this.redisService.get(CacheKey.EMAIL_VERIFICATION_PIN(email), CacheEmailSignIn.class);

        if (cachedPin.getVerifyAttemptCount() > MAX_ATTEMPT_COUNT) {
            this.redisService.set(CacheKey.EMAIL_VERIFICATION_PIN(email), cachedPin, 900);
            throw new TooManyRequestsException("EMAIL_VERIFY_CODE_MAX_ATTEMPTS_REACHED");
        }

        cachedPin.setVerifyAttemptCount(cachedPin.getVerifyAttemptCount() + 1);

        if (!cachedPin.getPin().equals(pin)) {
            this.redisService.set(CacheKey.EMAIL_VERIFICATION_PIN(email), cachedPin, 300);
            throw new BadRequestException("EMAIL_VERIFY_CODE_WRONG");
        }

        this.redisService.delete(CacheKey.EMAIL_VERIFICATION_PIN(email));
        log.info("Success");

        var firebaseAuth = FirebaseAuth.getInstance();
        UserRecord user = null;
        try {
            user = firebaseAuth.getUserByEmail(email);
        } catch (FirebaseAuthException e) {
            log.info("Error code {}", e.getAuthErrorCode());
            if (e.getAuthErrorCode() != AuthErrorCode.USER_NOT_FOUND) {
                throw new InternalServerErrorException("UNKNOWN");
            }
        }
        if (user == null) {
            user = firebaseAuth.createUser(
                    new UserRecord.CreateRequest().setEmail(email).setEmailVerified(true)
            );
        }
        return firebaseAuth.createCustomToken(user.getUid());
    }

    private boolean validateEmail(String email) {
        final Pattern pattern = Pattern.compile(Constants.EMAIL_REGEX);
        final Matcher matcher = pattern.matcher(email);
        return matcher.matches();
    }
}
