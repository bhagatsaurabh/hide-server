package me.saurabhagat.hide.auth_service.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class User {
    private String uid;
    private String name;
    private String email;
    private String picture;
    private String issuer;

    public User(String uid, String name, String email, String picture, String issuer) {
        this.uid = uid;
        this.name = name;
        this.email = email;
        this.picture = picture;
        this.issuer = issuer;
    }
}
