FROM node:20

WORKDIR /app

COPY . .
RUN npm install

EXPOSE 80

CMD ["npm", "start"]
