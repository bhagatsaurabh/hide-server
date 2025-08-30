package me.saurabhagat.hide.auth_service.service;

import com.azure.communication.email.*;
import com.azure.communication.email.implementation.models.EmailContent;
import com.azure.communication.email.models.*;
import com.azure.core.util.BinaryData;
import com.azure.core.util.polling.PollResponse;
import com.azure.core.util.polling.SyncPoller;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.thymeleaf.TemplateEngine;
import org.thymeleaf.context.Context;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.Base64;
import java.util.Calendar;

@Slf4j
@Service
public class EmailService {

    private final EmailClient emailClient;
    private final TemplateEngine templateEngine;

    @Value("${pin.sender}")
    private String senderEmail;

    public EmailService(@Value("${azure.communication.email.connection-string}") String connectionString,
                        TemplateEngine templateEngine) {
        this.emailClient = new EmailClientBuilder()
                .connectionString(connectionString)
                .buildClient();
        this.templateEngine = templateEngine;
    }

    public void sendPinEmail(String to, String pin) throws IOException {
        Context context = new Context();
        context.setVariable("pin", pin);
        context.setVariable("year", Calendar.getInstance().get(Calendar.YEAR));

        byte[] pngContent = Files.readAllBytes(new File("./static/logo.png").toPath());
        byte[] pngEncodedContent = Base64.getEncoder().encodeToString(pngContent).getBytes();
        EmailAttachment logoInlineAttachment = new EmailAttachment(
                "logo.png",
                "image/png",
                BinaryData.fromBytes(pngEncodedContent)
        ).setContentId("logo");

        String htmlContent = templateEngine.process("email-pin", context);
        String textContent = "Your one-time PIN is: " + pin + "\nIt will expire in 5 minutes.";

        EmailMessage message = new EmailMessage();
        message
                .setSenderAddress(senderEmail)
                .setBodyHtml(htmlContent)
                .setBodyPlainText(textContent)
                .setToRecipients(to)
                .setAttachments(logoInlineAttachment);

        SyncPoller<EmailSendResult, EmailSendResult> poller = emailClient.beginSend(message);
        var result = poller.waitForCompletion();
        log.info("Sent {}", result.getValue().getId());
    }
}
