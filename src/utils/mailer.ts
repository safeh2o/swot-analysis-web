var API_KEY = process.env.MAILGUN_API_KEY;
var DOMAIN = process.env.MAILGUN_DOMAIN;
var mailgun = require('mailgun-js')({apiKey: API_KEY, domain: DOMAIN, timeout: Number(process.env.MAILGUN_TIMEOUT)});
import { readFileSync, readdir} from 'fs';
import { basename, join } from 'path';

export function mail(from, to, subject, content, attachment) {
  const data = {
    from: from,
    to: to,
    subject: subject,
    html: escapeHtml(content),
    inline: null
  };

  if (attachment) {
    data.inline = attachment;
  }

  mailgun.messages().send(data, (error, body) => {
    if (error) {
      console.log(`Error occurred while sending email`, error);
    }
    console.log(`Email sent to ${to} with subject ${subject}`);
  });
}

export function escapeHtml(unsafe) {
  return unsafe
       .replace(/&/g, "&amp;")
       .replace(/</g, "&lt;")
       .replace(/>/g, "&gt;")
       .replace(/"/g, "&quot;")
       .replace(/'/g, "&#039;")
       .replace(/\\n/g, "<br>");
}

export function mailUser(to, subject, content, attachment) {
  mail(process.env.FROM_ADDRESS, to, subject, content, attachment);
}

export function mailAdmin(messageBody) {
  mail(process.env.FROM_ADDRESS, process.env.ADMIN_EMAIL, 'Message from SWOT Analyzer Application', messageBody, null);
}

export async function mailAllFilesInFolder(folder, to, from, subject, content) {
  return new Promise<any>(async (resolve, reject) => {
    var params = {
      to: to,
      from: from,
      subject: subject,
      html: content,
      attachment: []
    };

    console.log(`Mailing Octave files in ${folder}`);

    readdir(folder, function (err, files) {
      if (err) {
          return ('Unable to scan directory: ' + err);
      } 
      files.forEach(async function (file) {
        //const data = readFileSync(join(folder, file));
        params.attachment.push(new mailgun.Attachment({data: join(folder, file), filename: file}));
      });

      mailgun.messages().send(params, (err, body) => {
        if (err) {
          console.error('Error occurred while sending mail', err.message);
          reject(err);
        }
        console.log(body);
        resolve(body);
      })
    });
  })
}
