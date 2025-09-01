package me.saurabhagat.hide.auth_service.utils;

public class CacheKey {
    public static String EMAIL_VERIFICATION_PIN(String email) {
        return String.format("emailsignin:%s", email);
    }
}
