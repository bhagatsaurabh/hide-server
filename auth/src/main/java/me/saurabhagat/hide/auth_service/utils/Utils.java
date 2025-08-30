package me.saurabhagat.hide.auth_service.utils;

import java.security.SecureRandom;

public class Utils {
    private static final String CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    private static final SecureRandom secureRandom = new SecureRandom();

    public static String generatePin(int length) {
        StringBuilder sb = new StringBuilder(length);
        for (int idx = 0; idx < length; idx++) {
            int index = secureRandom.nextInt(CHARS.length());
            sb.append(CHARS.charAt(index));
        }
        return sb.toString();
    }
}
