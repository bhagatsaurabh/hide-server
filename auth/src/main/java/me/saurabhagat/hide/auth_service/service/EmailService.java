package me.saurabhagat.hide.auth_service.service;

import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;
import org.thymeleaf.TemplateEngine;
import org.thymeleaf.context.Context;

import java.io.UnsupportedEncodingException;
import java.util.Calendar;

@Slf4j
@Service
public class EmailService {

    private final JavaMailSender mailSender;
    private final TemplateEngine templateEngine;

    public EmailService(JavaMailSender mailSender, TemplateEngine templateEngine) {
        this.mailSender = mailSender;
        this.templateEngine = templateEngine;
    }

    public void sendPinEmail(String to, String pin) throws MessagingException, UnsupportedEncodingException {
        Context context = new Context();
        context.setVariable("pin", pin);
        context.setVariable("year", Calendar.getInstance().get(Calendar.YEAR));
        String htmlContent = templateEngine.process("email-pin", context);
        String textContent = "Your one-time PIN is: " + pin + "\nIt will expire in 5 minutes.";

        MimeMessage message = mailSender.createMimeMessage();
        MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
        helper.setFrom("DoNotReply@hide.saurabhagat.me", "H-IDE");
        helper.setTo(to);
        helper.setSubject("Your sign-in code");
        helper.setText(textContent, htmlContent);
        helper.addInline("logo", new ClassPathResource("static/logo.png"));
        helper.getMimeMessage().removeHeader("Reply-To");
        mailSender.send(message);
    }
}
