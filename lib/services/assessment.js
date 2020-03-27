
const Joi = require('joi');
const Schmervice = require('schmervice');
const _ = require('underscore');
const Boom = require('boom');
const CONSTANTS = require('../constants');

const internals = {};
internals.topicItemAssessmentConfigSchema = Joi.object({
  topic: Joi.string().valid(...CONSTANTS.questions.topics).required(),
  difficulty: Joi.object({
    easy: Joi.number().integer().required(),
    medium: Joi.number().integer().required(),
    hard: Joi.number().integer().required(),
  }),
  sortedByDifficulty: Joi.boolean().required(),
});
internals.bucketItemAssessmentConfig = Joi.object({
  bucketName: Joi.string().required(),
});

internals.assessmentConfigSchema = Joi.array().items(
  internals.topicItemAssessmentConfigSchema,
  internals.bucketItemAssessmentConfig,
);


module.exports = class AssessmentService extends Schmervice.Service {
  // NOT NEEDED
  async initialize() {
    this.questions = {};
    _.each(CONSTANTS.questions.topics, (topic) => {
      this.questions[topic] = { easy: [], medium: [], hard: [] };
    });

    // validate the assessment config
    Joi.attempt(CONSTANTS.questions.assessmentConfig, internals.assessmentConfigSchema);

    // TODO: check if the correct bucket names are used in the config

    // load the questions of the current version into the memory
    const { testVersioningService } = this.server.services();
    this.currentTestVersion = await testVersioningService.findCurrent();
    this.currentQuestions = await testVersioningService.getQuestions(this.currentTestVersion);
  }

  // DONE
  async generateAssessmentQuestions(txn = null) {
    const { assessmentConfig } = CONSTANTS.questions;
    const { QuestionSet } = this.server.models();

    const questionSet = [];
    const promises = [];
    _.each(assessmentConfig, (config) => {
      // one of the bucket choices need to be picked
      if (config.bucketName) {
        const bucket = _.where(this.currentQuestions.buckets, { name: config.bucketName })[0];
        const chosenChoiceIndex = _.random(0, bucket.choices.length - 1);
        const choice = bucket.choices[chosenChoiceIndex];
        const { questions } = bucket.choices[chosenChoiceIndex];
        questionSet.push({
          sectionName: bucket.name, 
          enHelpText: choice.enHelpText,
          hiHelpText: choice.hiHelpText,
          questions,
        });
      } else if (config.topic) {
        // questions of the given topic of the particular difficulty level need to be picked
        let topicQuestions = [];
        _.each(config.difficulty, (nQuestions, level) => {
          const questions = _.sample(this.currentQuestions.withoutChoices[config.topic][level],
            nQuestions);
          topicQuestions.push(questions);
        });
        topicQuestions = _.flatten(topicQuestions);
        if (config.sortedByDifficulty) {
          topicQuestions = _.sortBy(topicQuestions, (q) => q.difficulty);
        } else {
          topicQuestions = _.shuffle(topicQuestions);
        }
        const { topicHelpTextService } = this.server.services();
        const promise = topicHelpTextService.findByName(config.topic).then((topicHelp) => {
          questionSet.push({
            sectionName: topicHelp.name,
            enHelptext: topicHelp.enHelpText,
            hiHelpText: topicHelp.hiHelpText,
            questions: topicQuestions,
          });
        });
        promises.push(promise);
      }
    });
    await Promise.all(promises);

    // create the question set row in DB
    const questionSetForDB = _.map(questionSet, (section) => {
      const questionIds = _.map(section.questions, q => q.id);
      let newSection = _.omit(section, 'questions');
      return { ...newSection, questionIds };
    });
    const questionSetDB = await QuestionSet.query(txn).insert({
      questionIds: JSON.stringify(questionSetForDB),
      versionId: this.currentTestVersion.id,
    });

    // add the question set with question objects (not just IDs) on the question set object from DB
    questionSetDB.questions = questionSet;

    return questionSetDB;
  }

  // NOT NEEDED
  async validateEnrolmentKey(Key, txn = null) {
    let key = Key;
    const { EnrolmentKey } = this.server.models();

    key = await EnrolmentKey.query(txn).where({ key }).eager('student');
    if (!key.length) {
      return false;
    }
    return key[0];
  }

  // NOT NEEDED
  getEnrolmentKeyStatus(key) {
    /* Gives the status of the key. */
    /* The key can be in the following states: */
    /*
         * - testAnswered : The student has answered the test
         * - testStarted : The student has started the test but not answered it yet
         * - testTimeOverdue : #TODO: Will be implemented later
         * - testNotStarted : The student has not yet started answering the test
         */

    let status = 'testNotStarted';
    if (key.startTime && key.endTime) {
      status = 'testAnswered';
    } if (key.startTime && !key.endTime) {
      status = 'testStarted';
    }
    return status;
  }

  // DONE
  async createQuestionSetForPartner(txn) {
    console.log('Hello! I am creating a question set for a partner.');

    const questionSet = await this.generateAssessmentQuestions();

    return {
      questionSet,
      questions: questionSet.questions,
    };
  }

  // DONE
  async getQuestionsOfQuestionSet(questionSetId, txn = null) {
    const { Question, QuestionSet } = this.server.models();
    const questionSet = await QuestionSet.query(txn).findById(questionSetId);

    // get all the question IDs and retrieve the questions from DB
    let questionPaper = JSON.parse(questionSet.questionIds);
    let questionIds = _.map(questionPaper, (section) => {
      return section.questionIds;
    });
    questionIds = _.flatten(questionIds);
    let allQuestions = await Question.query(txn).findByIds(questionIds).eager('options');

    // add all the questions in the JSON from the DB which has the question IDs
    questionPaper = _.map(questionPaper, (section) => {
      let qs = _.map(section.questionIds, (qId) => {
        const question = _.where(allQuestions, { id: qId })[0];
        return question;
      });
      section.questions = qs;
      return section;
    });

    questionSet.questions = questionPaper;
    return questionSet;
  }

  // DONE
  async getQuestionSetForEnrolmentKey(key, txn = null) {
    const { QuestionSet, EnrolmentKey } = this.server.models();

    // let questions; 
    let questionSet;
    // TODO: start time needs to be taken into consideration and amount of time left
    // for the student needs to be returned.
    if (key.questionSetId) { // the question set has already been created
      questionSet = await this.getQuestionsOfQuestionSet(key.questionSetId);
    } else {
      questionSet = await this.generateAssessmentQuestions();

      // record the start time on the enrolment key object
      await EnrolmentKey.query(txn).patch({
        startTime: new Date(),
        questionSetId: questionSet.id,
      }).where({ id: key.id });
    }

    console.log(this.getAnswerObjectForAPI(questionSet.questions));
    return questionSet.questions;
  }

  getMarksForAttempt(attemptObj) {
    const { question } = attemptObj;
    let marks = 0;
    // let correctOption;
    const diffLevelStr = _.invert(CONSTANTS.questions.difficulty)[question.difficulty];
    if (question.type === CONSTANTS.questions.types.integer) {
      const [correctOption] = question.options;
      if (correctOption.text === attemptObj.textAnswer) {
        marks = CONSTANTS.questions.markingScheme[diffLevelStr];
      }
    } else {
      const [correctOption] = _.where(question.options, { correct: true });
      if (correctOption.id === attemptObj.selectedOptionId) {
        marks = CONSTANTS.questions.markingScheme[diffLevelStr];
      }
    }
    return marks;
  }

  // DONE
  getAnswerObjectForAPI(questions) {
    let apiBody = _.map(questions, (section) => {
      const secQuestions = _.map(section.questions, (q) => {
        let correctOption = {};
        _.each(q.options, (option, index) => {
          if (option.correct === true) {
            correctOption = {
              id: option.id,
              index: index + 1,
              text: option.text,
            };
          }
        });
        if (q.type === CONSTANTS.questions.types.integer) {
          return [q.id, correctOption.text];
        }
        return [q.id, correctOption.id]
      });
      return secQuestions;
    });

    apiBody = _.object( _.flatten(apiBody, true) );
    return JSON.stringify(apiBody, null, 2);
  }

  // DONE
  getAttempts(answers, key, questions) {
    let totalMarks = 0;

    let attempts = _.map(questions, (section) => {
      return _.map(section.questions, (q) => {
        const attempt = {
          enrolmentKeyId: key.id,
          questionId: q.id,
          question: q,
        };
        if (q.type === CONSTANTS.questions.types.integer) {
          attempt.textAnswer = typeof answers[q.id] === 'string' ? answers[q.id].trim() : null;
        } else {
          attempt.selectedOptionId = answers[q.id] === null ? null : Number(answers[q.id]);
        }
        totalMarks += this.getMarksForAttempt(attempt);
        return _.omit(attempt, 'question');
      });
    });
    attempts = _.flatten(attempts, true);

    return { attempts, totalMarks };
  }

  // NOT NEEDED
  async inFormTestResult(key, totalMarks) {
    const { EnrolmentKey } = this.server.models();
    const Key = key; const totalMark = totalMarks;
    const [studentDetail] = await EnrolmentKey.query().eager({
      student: {
        contacts: true,
      },
      questionSet: {
        testVersion: true,
      },
    }).where('studentId', Key.studentId);
    const testVersion = studentDetail.questionSet.testVersion.name;
    let stage;

    // Mark the student as pass / fail according to the gender specific cut off
    const studentGender = studentDetail.student.gender;
    const cutOff = CONSTANTS.testCutOff[_.invert(CONSTANTS.studentDetails.gender)[studentGender]];

    if (totalMark >= cutOff[testVersion]) {
      stage = 'pendingEnglishInterview';
    } else {
      stage = 'testFailed';
    }

    await this.patchStudentDetails(studentDetail, { stage });
  }

  answersAddQuestionIds(answers, questions) {
    const newAnswers = {};
    const charOptions = ['a', 'b', 'c', 'd', 'e'];

    _.each(questions, (question, index) => {
      let answerValue;
      const studentAttempt = answers[index + 1];

      // return if the studentAttempt is a null
      if (studentAttempt === null) {
        newAnswers[question.id] = studentAttempt;
        return;
      }

      if (question.type === CONSTANTS.questions.types.mcq) {
        const oIndex = charOptions.indexOf(studentAttempt.toLowerCase());
        answerValue = question.options[oIndex].id;
      } else { // question is of integer type means a single answer
        answerValue = String(studentAttempt);
      }

      newAnswers[question.id] = answerValue;
    });

    return newAnswers;
  }

  async recordOfflineStudentAnswers(StudentDetails, Answers, questionSet, txn = null) {
    // taken out and deleted typeOfTest from studentDetails and instert into enrolment_keys table.
    let studentDetails = StudentDetails;
    let answers = Answers;
    const { studentService } = this.server.services();
    const { EnrolmentKey, QuestionAttempt } = this.server.models();

    studentDetails = studentService.swapEnumKeysWithValues(studentDetails);

    const student = await studentService.create('basicDetailsEntered', null, studentDetails);

    // create an enrolment key for the student (mark the question set)
    const key = await EnrolmentKey.generateNewKey(student.id, questionSet.id);
    answers = this.answersAddQuestionIds(answers, questionSet.questions);
    const { attempts, totalMarks } = this.getAttempts(answers, key, questionSet.questions);
    await QuestionAttempt.query(txn).insertGraph(attempts); // attempts

    // record the total marks on the enrolment key
    await EnrolmentKey.query(txn).patch({
      totalMarks,
      typeOfTest: 'offlineTest',
    }).where({ id: key.id });

    await this.inFormTestResult(key, totalMarks);
  }

  //
  async recordStudentAnswers(key, answers, txn) {
    const { QuestionAttempt, EnrolmentKey } = this.server.models();

    // check if the question IDs in the answers object and the question IDs of the set match
    const questions = await this.getQuestionSetForEnrolmentKey(key);
    const answersQuestionIds = _.map(_.keys(answers), Number);
    const questionIds = _.flatten(_.map(questions, (section) => {
      return _.map(section.questions, q => q.id);
    }));
    const ansDiff = _.difference(answersQuestionIds, questionIds);
    if (ansDiff.length !== 0) {
      throw Boom.badRequest("All answers provided don't belong to the given question set.");
    }

    // create attempt objects to store in DB and calculate score
    const { attempts, totalMarks } = this.getAttempts(answers, key, questions);
    await QuestionAttempt.query(txn).insertGraph(attempts); // attempts

    // record the end time and total marks scored by the student
    await EnrolmentKey.query(txn).patch({
      endTime: new Date(),
      totalMarks,
    }).where({ id: key.id });

    await this.inFormTestResult(key, totalMarks);
  }

  // NOT NEEDED
  async addOrUpdateWhatsappNumber(studentId, whatsappNum, txn = null) {
    // if the whatsapp number is given check if it exists in DB then mark
    // isWhatsapp as true otherwise create a new contact and mark isWhatsapp as true

    const { Contact } = this.server.models();
    const contacts = await Contact.query(txn).where({ mobile: whatsappNum, studentId });
    if (contacts.length === 0) {
      await Contact.query(txn).insert({
        mobile: whatsappNum,
        studentId,
        isWhatsapp: true,
      });
    } else {
      await Contact.query(txn).patch({
        isWhatsapp: true,
      }).where({ studentId, mobile: whatsappNum });
    }
  }

  // NOT NEEDED
  async recordStageTranisiton(student, toStage, txn = null) {
    const { StageTransition } = this.server.models();
    const { exotelService } = this.server.services();

    await StageTransition.query(txn).insert({
      studentId: student.id,
      fromStage: student.stage,
      toStage,
    });

    // send sms after recording the stage transitions
    if (exotelService.hasTemplateForStage(toStage) === true) {
      if (!student.contacts) {
        await student.$relatedQuery('contacts');
      }
      const sendSMSPromises = [];
      _.each(student.contacts, (contact) => {
        const templateContext = {
          student,
          contact,
        };
        sendSMSPromises.push(exotelService.sendSMS(contact.mobile, toStage, templateContext));
      });
      const SMSSend = await Promise.all(sendSMSPromises);
      return SMSSend;
    }

    return null;
  }

  // NOT NEEDED
  async patchStudentDetails(key, Details = {}, txn = null) {
    const details = Details;
    const { Student } = this.server.models();
    // update stage of student if specified
    if (details.stage) {
      await this.recordStageTranisiton(key.student, details.stage, txn);
    }

    if (details.whatsapp) {
      const { whatsapp } = details;
      await this.addOrUpdateWhatsappNumber(key.studentId, whatsapp, txn);
      delete details.whatsapp;
    }

    if (!details.name) { // patch the other details on the student table
      const patchStudentDetail = await Student.query(txn).patch(details)
        .where({ id: key.student.id });
      return patchStudentDetail;
    }
    const patchStudentDetail = await Student.query(txn).patch(details).where({ id: key.studentId });
    return patchStudentDetail;
  }

  // NOT NEEDED
  async patchStudentDetailsWithoutKeys(student, Details, txn = null) {
    const details = Details;
    // update stage of student if specified
    if (details.stage) {
      await this.recordStageTranisiton(student, details.stage, txn);
    }

    if (details.whatsapp) {
      const { whatsapp } = details;
      await this.addOrUpdateWhatsappNumber(student.id, whatsapp, txn);
      delete details.whatsapp;
    }
  }

  // NOT NEEDED
  async ShowTestResult(Key, txn = null) {
    let key = Key;
    const { EnrolmentKey } = this.server.models();

    key = await EnrolmentKey.query(txn).where({ key }).eager({
      student: true,
      questionSet: {
        testVersion: true,
      },
    });
    const { student, questionSet } = key[0];
    if (key.length && questionSet) {
      const { testVersion } = questionSet;
      const TestVersion = testVersion.name;
      const studentGender = student.gender;
      const cutOff = CONSTANTS.testCutOff[_.invert(CONSTANTS.studentDetails.gender)[studentGender]];
      const Result = key[0].totalMarks >= cutOff[TestVersion] ? 'Passed' : 'Failed';
      return {
        Result,
        totalMarks: key[0].totalMarks,
      };
    }
    return null;
  }
};
