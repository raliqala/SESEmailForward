const AWS = require('aws-sdk');
const forwardFrom = process.env.from_address;
const forwardTo = process.env.to_address;

function contentType(content, sentFrom, type, messageContext) {
    const data = `\nEmail origin: ${sentFrom}.\n\n`;

    let isBase64 = false;

    if (messageContext === 'base64' || content.includes('base64')) {
        isBase64 = true;
    }

    content = content
        .replace(/Content-Transfer-Encoding: quoted-printable/gi, '')
        .replace(/Content-Transfer-Encoding: base64/gi, '');

    if (isBase64) {
        let lastLine = null;
        let cleanUp = '';

        if (type === 'htmlText') {
            lastLine = content.match(/--.+?--/g, '');
            cleanUp = content
                .replace(/--.+?--/g, '')
                .trim()
                .replace(/\n/g, '');
        } else {
            lastLine = content.match(/--[\s\S]*?\n/g, '');
            cleanUp = content
                .replace(/--[\s\S]*?\n/g, '')
                .trim()
                .replace(/\n/g, '');
        }

        let newContent = btoa(`${data}${atob(cleanUp)}`);

        if (lastLine) {
            newContent += `\n\n${lastLine[0]}\n`;
        }

        return `Content-Transfer-Encoding: base64\n ${newContent}`;
    }

    return `Content-Transfer-Encoding: quoted-printable\n ${data}${content}`;
}

function plainPartRegex(message) {
    const plainPartRegex1 =
        /Content-Type: text\/plain[\s\S]*?Content-Type: text\/html; charset=utf-8/gi;
    const plainPartRegex2 =
        /Content-Type: text\/plain[\s\S]*?Content-Type: text\/html; charset="utf-8"/gi;
    const plainPartRegex3 =
        /Content-Type: text\/plain[\s\S]*?Content-Type: text\/html;charset="utf-8"/gi;
    const plainPartRegex4 =
        /Content-Type: text\/plain[\s\S]*?Content-Type: text\/html;charset=utf-8/gi;
    const plainPartRegex5 =
        /Content-Type:text\/plain[\s\S]*?Content-Type: text\/html;charset="utf-8"/gi;

    return (
        message.match(plainPartRegex1) ||
        message.match(plainPartRegex2) ||
        message.match(plainPartRegex3) ||
        message.match(plainPartRegex4) ||
        message.match(plainPartRegex5)
    );
}

function htmlPartRegex(message) {
    const htmlPartRegex1 = /Content-Type: text\/html[\s\S]*?--.+?--/gi;
    const htmlPartRegex2 = /Content-Type:text\/html[\s\S]*?--.+?--/gi;

    return message.match(htmlPartRegex1) || message.match(htmlPartRegex2);
}

function replacing(email, sentTo) {
    let message = email;

    const contentTypeHTML = 'Content-Type: text/html; charset=utf-8';
    const contentTypeHTMLRegex =
        /Content-Type: text\/html; charset=utf-8|Content-Type: text\/html; charset="utf-8"/gi;
    const contentTypePlain = 'Content-Type: text/plain; charset=utf-8';
    const contentTypePlainRegex =
        /Content-Type: text\/plain; charset="utf-8"|Content-Type: text\/plain; charset=utf-8/gi;

    let messageContext = '';
    if (message.match(/Content-Transfer-Encoding: quoted-printable/gi)) {
        messageContext = 'quoted-printable';
    } else if (message.match(/Content-Transfer-Encoding: base64/gi)) {
        messageContext = 'base64';
    }

    const plainPartRegexMatch = plainPartRegex(message);

    // Plain part edit
    if (plainPartRegexMatch) {
        let cleanUp = plainPartRegexMatch[0].replace(contentTypeHTMLRegex, '');

        cleanUp = cleanUp.replace(contentTypePlainRegex, '');

        cleanUp = contentType(cleanUp, sentTo, 'plainText', messageContext);

        cleanUp = `${contentTypePlain}\n${cleanUp}${contentTypeHTML}`;

        message = message.replace(plainPartRegex(message), cleanUp);
    }

    const HTMLPartRegexMatch = htmlPartRegex(message);

    // HTML part edit
    if (HTMLPartRegexMatch) {
        let removal = HTMLPartRegexMatch[0].replace(contentTypeHTMLRegex, '');

        let htmlCleanUp = contentType(
            removal,
            sentTo,
            'htmlText',
            messageContext
        );

        htmlCleanUp = `${contentTypeHTML}\n${htmlCleanUp}`;

        message = message.replace(htmlPartRegex(message), htmlCleanUp);
    }

    return message
}

exports.handler = function (event, context) {
    const msgInfo = JSON.parse(event.Records[0].Sns.Message);

    console.log('xx', msgInfo)
    console.log('xxxxx', msgInfo.mail)

    // don't process spam messages
    if (msgInfo.receipt.spamVerdict.status === 'FAIL' || msgInfo.receipt.virusVerdict.status === 'FAIL') {
        console.log('Message is spam or contains virus, ignoring.');
        context.succeed();
    }

    let sentFrom = ""
    let sentTo = ""
    let subject = ""

    // At times commonHeaders is undefined
    if (msgInfo.mail.commonHeaders) {
        sentFrom = msgInfo.mail.commonHeaders.from[0]
        sentTo = msgInfo.mail.commonHeaders.to[0]
        subject = msgInfo.mail.commonHeaders.subject
    } else {

        for (const item of headers) {
            if (item.name === "From") {
                sentFrom = item.value;
            }

            if (item.name === "Subject") {
                subject = item.value;
            }

            if (item.name === "To") {
                sentTo = item.value;
            }

            if (subject && sentFrom && sentTo) {
                break;
            }
        }
    }

    if (!subject || !sentFrom || !sentTo) {
        context.fail()
    }
    const cleanFromSuorce = fromVal => {
        return fromVal
            .split("<")
            .pop()
            .replace(">", "");
    };

    // Add sentTo email to be part of reply recipients
    const replyRecipients = `${sentFrom}, ${sentTo}`
    console.log("xxxx-8", msgInfo.content);
    let email = msgInfo.content;
    let headers = "From: " + forwardFrom + "\r\n";
    console.log('xxxxx5', sentFrom, cleanFromSuorce(sentFrom), "From: " + cleanFromSuorce(sentFrom) + "\r\n");
    //  let headers = "From: " + cleanFromSuorce(sentFrom) + "\r\n";

    headers += "Reply-To: " + replyRecipients + "\r\n";
    headers += "X-Original-To: " + sentTo + "\r\n";
    headers += "To: " + forwardTo + "\r\n";
    headers += "Subject: Fwd: " + subject + "\r\n";

    if (email) {
        let res;
        res = email.match(/Content-Type:.+\s*boundary.*/);
        if (res) {
            headers += res[0] + "\r\n";
        } else {
            res = email.match(/^Content-Type:(.*)/m);
            if (res) {
                headers += res[0] + "\r\n";
            }
        }
        console.log("xxxx-88", email);
        res = email.match(/^Content-Transfer-Encoding:(.*)/m);
        if (res) {
            headers += res[0] + "\r\n";
        }

        res = email.match(/^MIME-Version:(.*)/m);
        if (res) {
            headers += res[0] + "\r\n";
        }
        console.log("xxxx-889", email);
        email = replacing(email, sentTo)

        const splitEmail = email.split("\r\n\r\n");
        splitEmail.shift();
        console.log("xxxx-8822", splitEmail);
        console.log("xxxx-88229", splitEmail.join("\r\n\r\n"));
        let emailSection = splitEmail.join("\r\n\r\n");
        let string = "";
        let foundH = false;
        const isHTML1 = RegExp.prototype.test.bind(/(<([^>]+)>)/i);
        emailSection.split(/\r?\n/)
            .forEach(s=>{
                if(!foundH && !s.startsWith("From:") && !s.startsWith("Reply-To:")
                    && !s.startsWith("X-Original-To:")
                    && !s.startsWith("Subject:")
                    && !s.startsWith("Content-Type:")
                    && !s.startsWith("Email origin:")
                    && isHTML1(s)){
                    foundH =true;
                    s = `<div>  <strong>Originally From: </strong> ${cleanFromSuorce(sentFrom)} <br> <strong> Originally To: </strong> ${sentTo}  </div><br><hr><br> \n`
                        +s;
                }
                string= string + s + '\n';
            });
        email = headers + "\r\n" + string;


        console.log('xxxxx1', email,);


    } else {
        email = headers + "\r\n" + "Empty email";
    }

    
    new AWS.SES().sendRawEmail({
        RawMessage: {Data: email}
    }, function (err, data) {
        if (err) context.fail(err);
        else {
            console.log('Sent with MessageId: ' + data.MessageId);
            context.succeed();
        }
    });
    


}
